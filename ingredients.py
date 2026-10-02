"""Pure ingredient logic: parsing, scaling, unit conversion, merge keys and aisles.

Nothing in this module touches the database, the network or Flask.
Quantities are always exact ``Fraction`` values; only formatting rounds.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction

MAX_QUANTITY = Fraction(10_000)
MAX_LINE_LENGTH = 200
MAX_LINES = 60

AISLES = (
    "Produce",
    "Dairy & Eggs",
    "Meat & Seafood",
    "Bakery",
    "Pantry",
    "Spices",
    "Frozen",
    "Other",
)

# --------------------------------------------------------------------------
# Units
# --------------------------------------------------------------------------

_UNIT_ALIASES = {
    "cup": ("cup", "cups", "c"),
    "tbsp": ("tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons"),
    "tsp": ("tsp", "tsps", "teaspoon", "teaspoons"),
    "pint": ("pint", "pints", "pt"),
    "quart": ("quart", "quarts", "qt"),
    "gallon": ("gallon", "gallons", "gal"),
    "g": ("g", "gr", "gm", "gram", "grams", "gramme", "grammes"),
    "kg": ("kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"),
    "ml": ("ml", "mls", "milliliter", "milliliters", "millilitre", "millilitres"),
    "l": ("l", "ltr", "liter", "liters", "litre", "litres"),
    "oz": ("oz", "ounce", "ounces"),
    "lb": ("lb", "lbs", "pound", "pounds"),
    "clove": ("clove", "cloves"),
    "can": ("can", "cans", "tin", "tins"),
    "jar": ("jar", "jars"),
    "slice": ("slice", "slices"),
    "pinch": ("pinch", "pinches"),
    "dash": ("dash", "dashes"),
    "bunch": ("bunch", "bunches"),
    "stick": ("stick", "sticks"),
    "piece": ("piece", "pieces", "pc", "pcs"),
    "sprig": ("sprig", "sprigs"),
    "head": ("head", "heads"),
    "handful": ("handful", "handfuls"),
    "package": ("package", "packages", "pkg", "pack", "packs", "packet", "packets"),
}
UNIT_LOOKUP = {alias: unit for unit, aliases in _UNIT_ALIASES.items() for alias in aliases}

# Abbreviated units never take an "s" when plural.
_INVARIANT_UNITS = {"tbsp", "tsp", "g", "kg", "ml", "oz", "lb"}
_UNIT_PLURALS = {"pinch": "pinches", "dash": "dashes", "bunch": "bunches"}
_UNIT_DISPLAY = {"l": "L"}

# Each family maps units to a factor of its smallest unit, so conversions stay exact.
_FAMILIES = (
    {"tsp": Fraction(1), "tbsp": Fraction(3), "cup": Fraction(48),
     "pint": Fraction(96), "quart": Fraction(192), "gallon": Fraction(768)},
    {"g": Fraction(1), "kg": Fraction(1000)},
    {"ml": Fraction(1), "l": Fraction(1000)},
    {"oz": Fraction(1), "lb": Fraction(16)},
)
UNIT_FAMILY = {unit: family for family in _FAMILIES for unit in family}

# Units a quantity may be converted *into*; pints/quarts/gallons are only read.
_AUTO_UNITS = {"tsp", "tbsp", "cup", "g", "kg", "ml", "l", "oz", "lb"}
# Smallest value worth showing in a unit ("1/4 cup" is fine, "1/16 cup" is not).
_MIN_VALUE = {"cup": Fraction(1, 4)}

_FRIENDLY_DENOMINATORS = (1, 2, 3, 4, 8)


def display_unit(unit: str | None, qty: Fraction | None = None) -> str:
    if not unit:
        return ""
    if unit in _UNIT_DISPLAY:
        return _UNIT_DISPLAY[unit]
    if unit in _INVARIANT_UNITS or qty is None or qty <= 1:
        return unit
    return _UNIT_PLURALS.get(unit, unit + "s")


def units_compatible(a: str | None, b: str | None) -> bool:
    if a == b:
        return True
    return a in UNIT_FAMILY and b in UNIT_FAMILY and UNIT_FAMILY[a] is UNIT_FAMILY[b]


def convert(qty: Fraction, from_unit: str, to_unit: str) -> Fraction:
    if from_unit == to_unit:
        return qty
    if not units_compatible(from_unit, to_unit):
        raise ValueError(f"cannot convert {from_unit} to {to_unit}")
    family = UNIT_FAMILY[from_unit]
    return qty * family[from_unit] / family[to_unit]


# --------------------------------------------------------------------------
# Quantity formatting
# --------------------------------------------------------------------------

def is_friendly(qty: Fraction) -> bool:
    return qty.denominator in _FRIENDLY_DENOMINATORS


def _round_friendly(qty: Fraction) -> Fraction:
    best = None
    for denominator in _FRIENDLY_DENOMINATORS:
        candidate = Fraction(round(qty * denominator), denominator)
        if best is None or abs(candidate - qty) < abs(best - qty):
            best = candidate
    if best == 0 and qty > 0:
        # Tiny amounts: keep a small exact-ish fraction rather than showing 0.
        return qty.limit_denominator(64) or Fraction(1, 64)
    return best


def format_quantity(qty: Fraction) -> str:
    """Render a quantity as a cook-friendly mixed fraction: 3, 1/2, 1 1/2, ~2/3."""
    prefix = ""
    if not is_friendly(qty):
        qty = _round_friendly(qty)
        prefix = "~"
    whole, remainder = divmod(qty.numerator, qty.denominator)
    if remainder == 0:
        return f"{prefix}{whole}"
    fraction = f"{remainder}/{qty.denominator}"
    return f"{prefix}{whole} {fraction}" if whole else f"{prefix}{fraction}"


def _decompose(qty: Fraction, unit: str | None) -> list[tuple[Fraction, str | None]] | None:
    """Split an unfriendly amount into whole + friendly remainder in a smaller unit.

    85/16 cup -> [(5, cup), (5, tbsp)]. Returns None when no clean split exists.
    """
    if is_friendly(qty):
        return [(qty, unit)]
    family = UNIT_FAMILY.get(unit)
    whole = Fraction(qty.numerator // qty.denominator)
    if not family or whole < 1:
        return None
    remainder = qty - whole
    smaller = sorted(
        (u for u in family if u in _AUTO_UNITS and family[u] < family[unit]),
        key=lambda u: family[u],
        reverse=True,
    )
    for candidate in smaller:
        value = convert(remainder, unit, candidate)
        if is_friendly(value):
            return [(whole, unit), (value, candidate)]
    return None


def normalize(qty: Fraction, unit: str | None, *, compound: bool = False) -> tuple[Fraction, str | None]:
    """Move a quantity into the largest sensible unit (3 tsp -> 1 tbsp, 1500 g -> 1 1/2 kg).

    A different unit is only chosen when it reads cleanly (halves and quarters, plus
    thirds of a cup), so 6 tbsp stays 6 tbsp rather than 3/8 cup and 4 tsp stays 4 tsp. With ``compound`` a split such as
    "2 cups + 1 tbsp" also counts as clean, which suits merged shopping amounts.
    """
    family = UNIT_FAMILY.get(unit)
    if not family:
        return qty, unit
    candidates = {u for u in family if u in _AUTO_UNITS} | {unit}
    for candidate in sorted(candidates, key=lambda u: family[u], reverse=True):
        value = convert(qty, unit, candidate)
        if value < _MIN_VALUE.get(candidate, 1):
            continue
        if (
            candidate == unit
            or value.denominator in (1, 2, 4)
            or (value.denominator == 3 and candidate == "cup")
            or (compound and _decompose(value, candidate))
        ):
            return value, candidate
    return qty, unit


def format_amount(qty: Fraction | None, unit: str | None) -> str:
    """'2 cups', '1 cup + 1 tbsp', '3' or '' for a missing quantity."""
    if qty is None:
        return ""
    parts = _decompose(qty, unit) or [(qty, unit)]
    rendered = []
    for value, part_unit in parts:
        text = format_quantity(value)
        if part_unit:
            text += " " + display_unit(part_unit, value)
        rendered.append(text)
    return " + ".join(rendered)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

_UNICODE_FRACTIONS = {
    "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
    "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
    "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}
_UNICODE_FRACTION_RE = re.compile(r"(?:(\d)\s*)?([" + "".join(_UNICODE_FRACTIONS) + "])")

_NUMBER = r"(?:\d{1,6}\s+\d{1,6}\s*/\s*\d{1,6}|\d{1,6}\s*/\s*\d{1,6}|\d{1,6}(?:\.\d{1,4})?|\.\d{1,4})"
_QUANTITY_RE = re.compile(
    rf"^(?P<low>{_NUMBER})(?:\s*(?:-|to)\s*(?P<high>{_NUMBER}))?(?![\d/.])"
)
# "2-inch piece ginger" describes a size, not an amount to scale.
_SIZE_RE = re.compile(r"^\s*-?\s*(?:inch|inches|in\.|cm|mm|\")(?=\W|$)", re.IGNORECASE)
_ARTICLE_RE = re.compile(r"^(?:a|an|one)\s+", re.IGNORECASE)
_UNIT_RE = re.compile(r"^(?P<note>\([^)]*\)\s*)?(?P<unit>[A-Za-z]+)\.?(?=[\s,(]|$)")
_BULLET_RE = re.compile(r"^\s*(?:[-*•·▪◦]+|\d{1,2}[.)])\s+")


@dataclass(frozen=True)
class Ingredient:
    raw: str
    qty: Fraction | None
    qty_high: Fraction | None
    unit: str | None
    note: str  # parenthetical between quantity and unit, e.g. "(14 oz)" in "1 (14 oz) can"
    text: str  # everything after the unit, e.g. "flour, sifted"

    @property
    def shopping_qty(self) -> Fraction | None:
        """Ranges shop for the upper bound so the cook has enough."""
        return self.qty_high if self.qty_high is not None else self.qty


def normalize_line(line: str) -> str:
    line = _BULLET_RE.sub("", line.replace("⁄", "/").replace("–", "-").replace("—", "-"))
    line = _UNICODE_FRACTION_RE.sub(
        lambda m: (m.group(1) + " " if m.group(1) else "") + _UNICODE_FRACTIONS[m.group(2)],
        line,
    )
    return " ".join(line.split())[:MAX_LINE_LENGTH]


_FRACTION_RE = re.compile(r"(?:(\d+)\s+)?(\d+)\s*/\s*(\d+)")


def parse_number(text: str) -> Fraction | None:
    """Parse '2', '1.5', '1/2' or '1 1/2'. Returns None for zero denominators or absurd values."""
    text = text.strip()
    fraction = _FRACTION_RE.fullmatch(text)
    try:
        if fraction:
            whole, numerator, denominator = fraction.groups()
            if int(denominator) == 0:
                return None
            value = int(whole or 0) + Fraction(int(numerator), int(denominator))
        else:
            value = Fraction(text)
    except (ValueError, ZeroDivisionError):
        return None
    if value <= 0 or value > MAX_QUANTITY:
        return None
    return value


def _unquantified(raw: str, line: str) -> Ingredient:
    return Ingredient(raw=raw, qty=None, qty_high=None, unit=None, note="", text=line)


def parse_line(raw: str) -> Ingredient:
    """Split an ingredient line into quantity, unit and the remaining text.

    Never raises: anything that is not a sensible quantity becomes an
    unquantified ingredient that is left as-is when scaling.
    """
    line = normalize_line(raw)
    match = _QUANTITY_RE.match(line)
    if match:
        low = parse_number(match.group("low"))
        high = parse_number(match.group("high")) if match.group("high") else None
        rest = line[match.end():]
        if low is None or (match.group("high") and high is None) or _SIZE_RE.match(rest):
            return _unquantified(raw, line)
        if high is not None and high <= low:
            high = None
    else:
        article = _ARTICLE_RE.match(line)
        unit_match = _UNIT_RE.match(line[article.end():]) if article else None
        if not (unit_match and unit_match.group("unit").lower() in UNIT_LOOKUP):
            return _unquantified(raw, line)
        low, high, rest = Fraction(1), None, line[article.end():]

    rest = rest.strip()
    unit, note = None, ""
    unit_match = _UNIT_RE.match(rest)
    if unit_match and unit_match.group("unit").lower() in UNIT_LOOKUP:
        unit = UNIT_LOOKUP[unit_match.group("unit").lower()]
        note = (unit_match.group("note") or "").strip()
        rest = rest[unit_match.end():].strip()

    # "3 garlic cloves" -> 3 clove garlic, so it merges with "2 cloves garlic".
    if unit is None:
        head, sep, tail = rest.partition(",")
        words = head.split()
        if len(words) >= 2 and words[-1].lower() in {"clove", "cloves"} and "garlic" in head.lower():
            unit, rest = "clove", " ".join(words[:-1]) + sep + tail

    return Ingredient(raw=raw, qty=low, qty_high=high, unit=unit, note=note, text=rest)


def split_lines(text: str) -> list[str]:
    """Split a textarea into ingredient lines, dropping blanks and capping count/length."""
    lines = []
    for raw in (text or "").splitlines():
        line = normalize_line(raw)
        if line:
            lines.append(line)
        if len(lines) >= MAX_LINES:
            break
    return lines


# --------------------------------------------------------------------------
# Words: plurals, cleaning, merge keys
# --------------------------------------------------------------------------

_SINGULAR_EXCEPTIONS = {
    "leaves": "leaf", "loaves": "loaf", "halves": "half", "knives": "knife",
    "pies": "pie", "cookies": "cookie", "brownies": "brownie", "veggies": "veggie",
    "chilies": "chili", "chillies": "chilli", "smoothies": "smoothie",
}
_UNCOUNTABLE = {
    "hummus", "couscous", "asparagus", "molasses", "swiss", "citrus", "grits",
    "series", "watercress", "bass", "lettuce", "garlic", "ginger", "rice", "flour",
    "sugar", "salt", "butter", "milk", "water", "oil", "cheese", "bread", "spinach",
}


def singularize(word: str) -> str:
    lower = word.lower()
    if lower in _UNCOUNTABLE or len(lower) <= 3:
        return word
    if lower in _SINGULAR_EXCEPTIONS:
        return _SINGULAR_EXCEPTIONS[lower]
    if lower.endswith("ies"):
        return word[:-3] + "y"
    if lower.endswith("oes") or re.search(r"(ch|sh|x|ss|z)es$", lower):
        return word[:-2]
    if lower.endswith("s") and not lower.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def pluralize(word: str) -> str:
    singular = singularize(word)
    lower = singular.lower()
    if lower in _UNCOUNTABLE:
        return singular
    for plural, single in _SINGULAR_EXCEPTIONS.items():
        if single == lower:
            return plural
    if re.search(r"[^aeiou]y$", lower):
        return singular[:-1] + "ies"
    if lower.endswith(("ch", "sh", "x", "s", "z")) or lower in {"tomato", "potato", "mango"}:
        return singular + "es"
    return singular + "s"


_NOISE_PHRASES = (
    "to taste", "as needed", "as required", "for garnish", "for serving", "for frying",
    "at room temperature", "room temperature", "or more", "plus more", "if desired",
)
_NOISE_WORDS = {
    # preparation
    "chopped", "minced", "diced", "sliced", "grated", "shredded", "melted", "softened",
    "beaten", "peeled", "crushed", "cubed", "halved", "quartered", "drained", "rinsed",
    "sifted", "packed", "finely", "roughly", "thinly", "coarsely", "freshly", "lightly",
    "divided", "optional", "cold", "warm",
    # size and quality
    "fresh", "large", "small", "medium", "ripe", "organic", "plain",
}
_PAREN_RE = re.compile(r"\([^)]*\)")


def clean_name(text: str) -> str:
    """Shopping-list name: lowercase, no parentheses, notes after a comma or preparation words."""
    name = _PAREN_RE.sub(" ", text.lower()).split(",")[0]
    name = re.sub(r"^\s*of\s+", "", name)
    for phrase in _NOISE_PHRASES:
        name = re.sub(rf"\b{phrase}\b", " ", name)
    words = [w for w in name.split() if w not in _NOISE_WORDS]
    cleaned = " ".join(words).strip(" .;:-*")
    return cleaned or " ".join(text.lower().split())[:MAX_LINE_LENGTH]


def merge_key(text: str) -> str:
    words = clean_name(text).split()
    if not words:
        return ""
    words[-1] = singularize(words[-1])
    return " ".join(words)


def display_name(name: str, qty: Fraction | None, unit: str | None) -> str:
    """'onion' with qty 3 and no unit reads as 'onions'; with a unit the name stays as typed."""
    if qty is None or unit or not name:
        return name
    words = name.split()
    words[-1] = pluralize(words[-1]) if qty > 1 else singularize(words[-1])
    return " ".join(words)


# --------------------------------------------------------------------------
# Scaling
# --------------------------------------------------------------------------

def _pluralize_text(text: str) -> str:
    head, sep, tail = text.partition(",")
    words = head.split()
    if not words or "(" in head:
        return text
    words[-1] = pluralize(words[-1])
    return " ".join(words) + (sep + tail if sep else "")


def scale_line(line: str, multiplier: Fraction | int) -> str:
    """Scale one ingredient line. Lines without a quantity come back unchanged."""
    multiplier = Fraction(multiplier)
    if multiplier <= 0:
        raise ValueError("multiplier must be positive")
    ingredient = parse_line(line)
    if ingredient.qty is None or multiplier == 1:
        return normalize_line(line)

    if ingredient.qty_high is not None:
        new_qty = ingredient.qty_high * multiplier
        amount = f"{format_quantity(ingredient.qty * multiplier)}-{format_quantity(new_qty)}"
        unit_text = display_unit(ingredient.unit, new_qty)
    else:
        new_qty, unit = normalize(ingredient.qty * multiplier, ingredient.unit)
        amount, unit_text = format_amount(new_qty, unit), ""

    text = ingredient.text
    if ingredient.unit is None and ingredient.qty <= 1 < new_qty:
        text = _pluralize_text(text)
    return " ".join(part for part in (amount, unit_text, ingredient.note, text) if part)


# --------------------------------------------------------------------------
# Aisles
# --------------------------------------------------------------------------

# Checked in order; the first matching phrase wins, so specific phrases come first.
_AISLE_RULES = (
    ("Frozen", ("frozen", "ice cream", "ice")),
    ("Pantry", (
        "baking powder", "baking soda", "peanut butter", "almond butter", "coconut milk",
        "coconut cream", "cream of tartar", "broth", "stock", "bouillon", "tomato paste",
        "tomato sauce", "soy sauce", "fish sauce", "breadcrumb", "bread crumb", "egg noodle", "noodle",
        "pasta", "canned",
    )),
    ("Meat & Seafood", (
        "chicken", "beef", "pork", "lamb", "mutton", "turkey", "bacon", "sausage", "ham",
        "fish", "salmon", "tuna", "shrimp", "prawn", "cod", "mince", "steak", "anchovy",
    )),
    ("Spices", (
        "powder", "ground", "dried", "flake", "salt", "black pepper", "white pepper",
        "peppercorn", "cumin", "turmeric", "paprika", "cinnamon", "nutmeg", "garam masala",
        "cardamom", "clove", "bay leaf", "curry", "saffron", "oregano", "chili flake",
        "seasoning", "allspice", "fenugreek", "mustard seed", "spice",
    )),
    ("Dairy & Eggs", (
        "milk", "buttermilk", "butter", "cheese", "cream", "yogurt", "yoghurt", "egg",
        "parmesan", "mozzarella", "cheddar", "feta", "paneer", "ghee", "curd",
    )),
    ("Bakery", (
        "bread", "bun", "tortilla", "pita", "bagel", "croissant", "naan", "baguette", "brioche",
    )),
    ("Produce", (
        "onion", "garlic", "ginger", "tomato", "potato", "carrot", "celery", "lettuce",
        "spinach", "mushroom", "apple", "banana", "lemon", "lime", "orange", "berry",
        "strawberry", "blueberry", "raspberry", "avocado", "cucumber", "zucchini", "pepper",
        "chili", "chilli", "jalapeno", "cilantro", "coriander", "parsley", "basil", "mint",
        "thyme", "rosemary", "dill", "scallion", "shallot", "cabbage", "broccoli",
        "cauliflower", "kale", "leek", "herb", "fruit", "vegetable", "eggplant", "squash",
        "pumpkin", "mango", "grape", "pear", "peach", "pea", "corn", "bean sprout",
    )),
    ("Pantry", (
        "flour", "sugar", "rice", "spaghetti", "oil", "vinegar", "oat", "bean", "lentil",
        "chickpea", "chocolate", "cocoa", "honey", "syrup", "yeast", "walnut", "almond",
        "cashew", "peanut", "pecan", "pistachio", "hazelnut", "nut", "vanilla", "extract",
        "sauce", "ketchup", "mustard", "mayonnaise", "cornstarch", "cereal", "raisin", "jam",
        "coffee", "tea", "quinoa", "tahini", "seed",
    )),
)


def aisle_for(key: str, unit: str | None = None) -> str:
    key = key.lower()
    if re.search(r"\bfrozen\b", key):
        return "Frozen"
    if unit in {"can", "jar"}:
        return "Pantry"
    for aisle, phrases in _AISLE_RULES:
        for phrase in phrases:
            if re.search(rf"\b{re.escape(phrase)}\b", key):
                return aisle
    return "Other"


def aisle_order(aisle: str) -> int:
    return AISLES.index(aisle) if aisle in AISLES else len(AISLES)


# --------------------------------------------------------------------------
# Non-AI fallbacks: category guess, recipe text parser, diet tags, substitutions
# --------------------------------------------------------------------------

CATEGORIES = ("Breakfast", "Dinner", "Dessert")
DIET_TAGS = ("vegetarian", "vegan", "gluten-free", "dairy-free", "contains nuts")

_CATEGORY_WORDS = {
    "Breakfast": ("breakfast", "pancake", "waffle", "omelette", "omelet", "porridge", "granola",
                  "toast", "muffin", "smoothie", "cereal", "scrambled", "frittata", "brunch"),
    "Dessert": ("dessert", "cake", "cookie", "brownie", "pie", "pudding", "ice cream", "crumble",
                "tart", "custard", "mousse", "cheesecake", "kheer", "halwa", "fudge", "sweet"),
}


def guess_category(text: str) -> str:
    text = text.lower()
    for category, words in _CATEGORY_WORDS.items():
        if any(re.search(rf"\b{re.escape(w)}s?\b", text) for w in words):
            return category
    return "Dinner"


_INGREDIENT_HEADER = re.compile(r"^\W*ingredients?\b\W*$", re.IGNORECASE)
_STEPS_HEADER = re.compile(
    r"^\W*(instructions?|method|directions?|steps?|preparation|how to make)\b", re.IGNORECASE
)
_TIME_RE = re.compile(r"(\d{1,3})\s*(?:-\s*\d{1,3}\s*)?(min|mins|minutes|hr|hrs|hour|hours)\b", re.IGNORECASE)


def _looks_like_ingredient(line: str) -> bool:
    return parse_line(line).qty is not None or bool(_BULLET_RE.match(line))


def parse_recipe_text(text: str) -> dict:
    """Best-effort recipe extraction from pasted text, used when Gemini is unavailable."""
    raw_lines = [line.strip() for line in (text or "").splitlines()]
    lines = [line for line in raw_lines if line]

    title = ""
    for line in lines:
        if _INGREDIENT_HEADER.match(line) or _STEPS_HEADER.match(line) or _looks_like_ingredient(line):
            continue
        title = re.sub(r"^\W*(title|recipe)\s*:\s*", "", line, flags=re.IGNORECASE).strip("#*= ")
        break

    prep_time = None
    for line in lines:
        match = _TIME_RE.search(line)
        if match:
            minutes = int(match.group(1)) * (60 if match.group(2).lower().startswith("h") else 1)
            prep_time = minutes if 0 < minutes <= 1440 else None
            if prep_time and "prep" in line.lower():
                break

    ingredients: list[str] = []
    header_index = next((i for i, line in enumerate(lines) if _INGREDIENT_HEADER.match(line)), None)
    if header_index is not None:
        for line in lines[header_index + 1:]:
            if _STEPS_HEADER.match(line):
                break
            ingredients.append(line)
    else:
        ingredients = [line for line in lines if line != title and _looks_like_ingredient(line)]

    ingredients = split_lines("\n".join(ingredients))
    return {
        "title": title[:120],
        "prep_time": prep_time,
        "category": guess_category(" ".join([title, *ingredients])),
        "ingredients": ingredients,
    }


_MEAT = ("chicken", "beef", "pork", "lamb", "mutton", "turkey", "bacon", "sausage", "ham", "fish",
         "salmon", "tuna", "shrimp", "prawn", "anchovy", "gelatin", "cod", "crab", "lobster",
         "steak", "mince", "fish sauce")
_DAIRY = ("milk", "butter", "cheese", "cream", "yogurt", "yoghurt", "ghee", "paneer", "parmesan",
          "mozzarella", "cheddar", "buttermilk", "curd", "whey")
_NOT_DAIRY = ("peanut butter", "almond butter", "cocoa butter", "coconut milk", "coconut cream",
              "almond milk", "oat milk", "soy milk", "cream of tartar")
_EGG = ("egg", "mayonnaise")
_GLUTEN = ("flour", "bread", "pasta", "spaghetti", "noodle", "wheat", "barley", "rye", "couscous",
           "breadcrumb", "cracker", "biscuit", "tortilla", "soy sauce", "beer", "semolina", "pita",
           "naan", "croissant", "macaroni", "seitan")
_GLUTEN_FREE_FLOURS = ("rice flour", "almond flour", "coconut flour", "corn flour", "chickpea flour",
                       "gluten-free flour", "buckwheat flour")
_NUTS = ("almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "peanut", "macadamia",
         "pine nut", "nut", "praline", "marzipan")


def _mentions(text: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(w)}(e?s)?\b", text) for w in words)


def _without(text: str, phrases: tuple[str, ...]) -> str:
    for phrase in phrases:
        text = re.sub(rf"\b{re.escape(phrase)}s?\b", " ", text)
    return text


def keyword_diet_tags(lines: list[str]) -> list[str]:
    """Diet tags from ingredient keywords. A rough estimate, not a guarantee."""
    text = " ".join(clean_name(parse_line(line).text) for line in lines)
    has_meat = _mentions(text, _MEAT)
    has_dairy = _mentions(_without(text, _NOT_DAIRY), _DAIRY)
    has_egg = _mentions(text, _EGG)
    has_gluten = _mentions(_without(text, _GLUTEN_FREE_FLOURS), _GLUTEN)
    tags = []
    if not has_meat:
        tags.append("vegetarian")
        if not has_dairy and not has_egg and not _mentions(text, ("honey",)):
            tags.append("vegan")
    if not has_gluten:
        tags.append("gluten-free")
    if not has_dairy:
        tags.append("dairy-free")
    if _mentions(text, _NUTS):
        tags.append("contains nuts")
    return tags


_SUBSTITUTIONS = {
    "butter": [("Oil (3/4 the amount)", "Works for sautéing and most cakes."),
               ("Ghee", "Same amount; nuttier flavour."),
               ("Applesauce", "Half the amount in baking; makes it denser.")],
    "egg": [("1 tbsp ground flax + 3 tbsp water", "Per egg; let it gel 5 minutes."),
            ("1/4 cup yogurt", "Per egg, for cakes and muffins."),
            ("1/4 cup mashed banana", "Per egg; adds sweetness.")],
    "milk": [("Any plant milk", "Same amount."),
             ("1/2 water + 1/2 yogurt", "Thin yogurt down to milk consistency.")],
    "buttermilk": [("1 cup milk + 1 tbsp lemon juice", "Stand 5 minutes before using."),
                   ("Thinned yogurt", "3/4 cup yogurt + 1/4 cup water.")],
    "cream": [("Milk + melted butter", "3/4 cup milk + 1/4 cup butter per cup."),
              ("Coconut cream", "Same amount; dairy-free.")],
    "sour cream": [("Greek yogurt", "Same amount.")],
    "yogurt": [("Sour cream", "Same amount."), ("Buttermilk", "For marinades and batters.")],
    "flour": [("Whole wheat flour", "Use a little less; denser result."),
              ("Gluten-free flour blend", "1:1 for most baking.")],
    "sugar": [("Honey", "3/4 the amount; reduce other liquid slightly."),
              ("Brown sugar", "Same amount; more caramel flavour.")],
    "brown sugar": [("White sugar + 1 tbsp molasses", "Per cup."), ("White sugar", "Same amount.")],
    "honey": [("Maple syrup", "Same amount."), ("Sugar + a splash of water", "1 1/4 cups sugar per cup.")],
    "baking powder": [("1/4 tsp baking soda + 1/2 tsp cream of tartar", "Per 1 tsp baking powder.")],
    "onion": [("Shallot", "Milder; use the same volume."), ("Leek", "Use the white part."),
              ("Onion powder", "1 tbsp per medium onion.")],
    "garlic": [("1/8 tsp garlic powder", "Per clove."), ("Shallot", "Different but aromatic.")],
    "lemon juice": [("Lime juice", "Same amount."), ("White vinegar", "Half the amount.")],
    "vinegar": [("Lemon juice", "Same amount.")],
    "breadcrumb": [("Crushed crackers", "Same amount."), ("Rolled oats", "Pulse briefly first.")],
    "cornstarch": [("Flour", "Twice the amount."), ("Arrowroot", "Same amount.")],
    "parmesan": [("Pecorino", "Saltier; use a little less."), ("Nutritional yeast", "Dairy-free.")],
    "chicken": [("Paneer or tofu", "Vegetarian; shorten the cooking time."),
                ("Turkey", "Same amount.")],
    "soy sauce": [("Tamari", "Gluten-free; same amount."), ("Coconut aminos", "Slightly sweeter.")],
    "tomato paste": [("Ketchup", "Same amount; sweeter."), ("Tomato puree", "Three times the amount, reduced.")],
    "coriander": [("Parsley", "Same amount; less citrusy."), ("Mint", "Use half.")],
    "oil": [("Melted butter", "Same amount."), ("Ghee", "Same amount.")],
    "rice": [("Quinoa", "Same amount; cooks faster."), ("Cauliflower rice", "Low-carb.")],
    "walnut": [("Pecans", "Same amount."), ("Sunflower seeds", "Nut-free.")],
}


def basic_substitutes(ingredient: str) -> list[dict]:
    """Built-in substitution suggestions for common ingredients."""
    key = merge_key(parse_line(ingredient).text)
    match = _SUBSTITUTIONS.get(key)
    if match is None:
        # Longest known name inside the key wins: "unsalted butter" -> butter.
        known = sorted((k for k in _SUBSTITUTIONS if re.search(rf"\b{re.escape(k)}\b", key)),
                       key=len, reverse=True)
        match = _SUBSTITUTIONS[known[0]] if known else []
    return [{"swap": swap, "note": note} for swap, note in match]
