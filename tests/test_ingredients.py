from fractions import Fraction

import pytest

import ingredients as ing


# ---------- quantities ----------

@pytest.mark.parametrize("line, qty", [
    ("2 cups flour", Fraction(2)),
    ("1.5 cups milk", Fraction(3, 2)),
    (".5 tsp salt", Fraction(1, 2)),
    ("1/2 cup sugar", Fraction(1, 2)),
    ("1 1/2 cups milk", Fraction(3, 2)),
    ("1 1 / 2 cups milk", Fraction(3, 2)),
    ("½ cup sugar", Fraction(1, 2)),
    ("1½ tsp salt", Fraction(3, 2)),
    ("1 ½ tsp salt", Fraction(3, 2)),
    ("¾ cup butter", Fraction(3, 4)),
    ("1⁄3 cup oil", Fraction(1, 3)),
    ("200g spaghetti", Fraction(200)),
    ("a pinch of salt", Fraction(1)),
    ("- 2 eggs", Fraction(2)),
    ("• 3 apples", Fraction(3)),
    ("- ¾ cup sugar", Fraction(3, 4)),
    ("- 1 ½ cups flour", Fraction(3, 2)),
])
def test_parses_quantities(line, qty):
    assert ing.parse_line(line).qty == qty


@pytest.mark.parametrize("line, low, high", [
    ("1-2 tbsp oil", Fraction(1), Fraction(2)),
    ("1 - 2 tbsp oil", Fraction(1), Fraction(2)),
    ("1–2 tbsp oil", Fraction(1), Fraction(2)),
    ("1 to 2 cups stock", Fraction(1), Fraction(2)),
    ("1/2-1 cup milk", Fraction(1, 2), Fraction(1)),
])
def test_parses_ranges(line, low, high):
    parsed = ing.parse_line(line)
    assert (parsed.qty, parsed.qty_high) == (low, high)
    assert parsed.shopping_qty == high


@pytest.mark.parametrize("line", [
    "salt to taste",
    "black pepper",
    "2-inch piece ginger, grated",
    "2 inch piece ginger",
    "1/0 cup flour",
    "0 cups flour",
    "99999999 g sugar",
    "20000 kg flour",
    "",
    "   ",
])
def test_lines_without_a_sensible_quantity_never_crash(line):
    assert ing.parse_line(line).qty is None
    assert ing.scale_line(line, 3) == ing.normalize_line(line)


def test_to_inside_a_word_is_not_a_range():
    parsed = ing.parse_line("1 tomato")
    assert (parsed.qty, parsed.qty_high, parsed.text) == (1, None, "tomato")


def test_parse_number_rejects_bad_values():
    assert ing.parse_number("1/0") is None
    assert ing.parse_number("0") is None
    assert ing.parse_number("10001") is None
    assert ing.parse_number("abc") is None
    assert ing.parse_number("2 3/4") == Fraction(11, 4)


# ---------- units ----------

@pytest.mark.parametrize("line, unit", [
    ("2 cups flour", "cup"), ("1 cup flour", "cup"), ("2 c flour", "cup"),
    ("1 tablespoon oil", "tbsp"), ("2 Tbsp. oil", "tbsp"), ("1 tbs oil", "tbsp"),
    ("1 teaspoon salt", "tsp"), ("2 tsps salt", "tsp"),
    ("500 grams beef", "g"), ("2 kgs potatoes", "kg"), ("1 kilo rice", "kg"),
    ("250 ml milk", "ml"), ("1 litre water", "l"), ("2 L water", "l"),
    ("8 ounces cheese", "oz"), ("2 lbs chicken", "lb"), ("1 pound beef", "lb"),
    ("4 cloves garlic", "clove"), ("1 can beans", "can"), ("2 tins tomatoes", "can"),
    ("3 slices bread", "slice"), ("2 pinches salt", "pinch"), ("1 bunch coriander", "bunch"),
    ("1 stick butter", "stick"), ("2 pieces chicken", "piece"),
])
def test_recognizes_units_and_aliases(line, unit):
    assert ing.parse_line(line).unit == unit


def test_unit_words_inside_names_are_not_units():
    parsed = ing.parse_line("2 large eggs")
    assert parsed.unit is None and parsed.text == "large eggs"
    assert ing.parse_line("1 lemon").unit is None
    assert ing.parse_line("2 garlic bulbs").unit is None


def test_garlic_cloves_are_normalized_to_clove_unit():
    parsed = ing.parse_line("3 garlic cloves, minced")
    assert (parsed.qty, parsed.unit, parsed.text) == (3, "clove", "garlic, minced")


@pytest.mark.parametrize("line, qty, unit, text", [
    ("1 cup + 2 tbsp milk", Fraction(9, 8), "cup", "milk"),
    ("1 cup plus 2 tablespoons milk", Fraction(9, 8), "cup", "milk"),
    ("2 cups + 1 tbsp + 1 tsp water", Fraction(25, 12), "cup", "water"),
    ("1 lb + 4 oz beef", Fraction(5, 4), "lb", "beef"),
    # Amounts that can't be added stay as they were.
    ("1 cup + 50 g flour", Fraction(1), "cup", "+ 50 g flour"),
    ("2 tbsp + 2 eggs", Fraction(2), "tbsp", "+ 2 eggs"),
    ("1-2 cups + 1 tbsp stock", Fraction(1), "cup", "+ 1 tbsp stock"),
])
def test_compound_amounts_fold_into_one_quantity(line, qty, unit, text):
    parsed = ing.parse_line(line)
    assert (parsed.qty, parsed.unit, parsed.text) == (qty, unit, text)


def test_parenthetical_note_before_unit_is_kept():
    parsed = ing.parse_line("1 (14 oz) can chopped tomatoes")
    assert (parsed.unit, parsed.note, parsed.text) == ("can", "(14 oz)", "chopped tomatoes")


@pytest.mark.parametrize("unit, qty, expected", [
    ("cup", Fraction(1), "cup"), ("cup", Fraction(1, 2), "cup"), ("cup", Fraction(3, 2), "cups"),
    ("tbsp", Fraction(3), "tbsp"), ("g", Fraction(500), "g"), ("lb", Fraction(2), "lb"),
    ("clove", Fraction(4), "cloves"), ("pinch", Fraction(2), "pinches"), ("bunch", Fraction(2), "bunches"),
    ("l", Fraction(2), "L"),
])
def test_unit_pluralization(unit, qty, expected):
    assert ing.display_unit(unit, qty) == expected


# ---------- formatting ----------

@pytest.mark.parametrize("qty, text", [
    (Fraction(3), "3"), (Fraction(1, 2), "1/2"), (Fraction(3, 2), "1 1/2"),
    (Fraction(2, 3), "2/3"), (Fraction(9, 8), "1 1/8"), (Fraction(33, 100), "~1/3"),
    (Fraction(99, 100), "~1"), (Fraction(1, 100), "~1/64"),
])
def test_format_quantity_is_friendly(qty, text):
    assert ing.format_quantity(qty) == text
    assert "." not in ing.format_quantity(qty)


def test_format_amount_compounds_awkward_volumes():
    assert ing.format_amount(Fraction(85, 16), "cup") == "5 cups + 5 tbsp"
    assert ing.format_amount(Fraction(17, 16), "cup") == "1 cup + 1 tbsp"
    assert ing.format_amount(Fraction(2), None) == "2"
    assert ing.format_amount(None, "cup") == ""


# ---------- scaling ----------

@pytest.mark.parametrize("line, multiplier, expected", [
    ("1 1/2 cups flour, sifted", 2, "3 cups flour, sifted"),
    ("1 1/2 cups flour", 3, "4 1/2 cups flour"),
    ("1/3 cup sugar", 2, "2/3 cup sugar"),
    ("½ cup sugar", 2, "1 cup sugar"),
    ("1 cup sugar", 2, "2 cups sugar"),
    ("1 egg", 3, "3 eggs"),
    ("2 large eggs", 2, "4 large eggs"),
    ("1 tomato, diced", 2, "2 tomatoes, diced"),
    ("1 tsp salt", 3, "1 tbsp salt"),
    ("2 tsp garam masala", 2, "4 tsp garam masala"),
    ("3 tbsp butter", 2, "6 tbsp butter"),
    ("3 tbsp butter", 4, "3/4 cup butter"),
    ("250 g pasta", 4, "1 kg pasta"),
    ("750 g flour", 2, "1 1/2 kg flour"),
    ("8 oz cheese", 2, "1 lb cheese"),
    ("1-2 tbsp oil", 2, "2-4 tbsp oil"),
    ("1 to 2 cups stock", 3, "3-6 cups stock"),
    ("a pinch of salt", 2, "2 pinches of salt"),
    ("1 (14 oz) can tomatoes", 2, "2 cans (14 oz) tomatoes"),
    ("3 garlic cloves, minced", 2, "6 cloves garlic, minced"),
    ("0.33 cup oil", 3, "~1 cup oil"),
    ("1 cup + 2 tbsp milk", 2, "2 1/4 cups milk"),
    ("1 lb + 4 oz beef", 2, "2 1/2 lb beef"),
])
def test_scale_line(line, multiplier, expected):
    assert ing.scale_line(line, multiplier) == expected


def test_scale_by_one_returns_the_line_unchanged():
    assert ing.scale_line("2 Tablespoons  olive oil", 1) == "2 Tablespoons olive oil"


@pytest.mark.parametrize("line", ["salt to taste", "2-inch piece ginger", "fresh coriander, to garnish"])
@pytest.mark.parametrize("multiplier", [2, 3, 4])
def test_scaling_leaves_unquantified_lines_alone(line, multiplier):
    assert ing.scale_line(line, multiplier) == line


def test_scale_rejects_non_positive_multiplier():
    with pytest.raises(ValueError):
        ing.scale_line("1 cup flour", 0)


# ---------- conversion and normalization ----------

def test_convert_between_compatible_units():
    assert ing.convert(Fraction(1), "cup", "tbsp") == 16
    assert ing.convert(Fraction(1), "tbsp", "tsp") == 3
    assert ing.convert(Fraction(1500), "g", "kg") == Fraction(3, 2)
    assert ing.convert(Fraction(1), "l", "ml") == 1000
    assert ing.convert(Fraction(1), "lb", "oz") == 16
    with pytest.raises(ValueError):
        ing.convert(Fraction(1), "cup", "g")


@pytest.mark.parametrize("a, b, compatible", [
    ("tsp", "cup", True), ("g", "kg", True), ("ml", "l", True), ("cup", "cup", True),
    (None, None, True), ("cup", "g", False), ("ml", "cup", False), ("cup", None, False),
    ("clove", "can", False), ("pinch", "tsp", False),
])
def test_units_compatible(a, b, compatible):
    assert ing.units_compatible(a, b) is compatible


def test_normalize_picks_a_sensible_unit():
    assert ing.normalize(Fraction(3), "tsp") == (1, "tbsp")
    assert ing.normalize(Fraction(16), "tbsp") == (1, "cup")
    assert ing.normalize(Fraction(500), "g") == (500, "g")
    assert ing.normalize(Fraction(1000), "ml") == (1, "l")
    assert ing.normalize(Fraction(2), "clove") == (2, "clove")
    # compound mode accepts "2 cups + 1 tbsp" style amounts for merged items
    assert ing.normalize(Fraction(33), "tbsp", compound=True) == (Fraction(33, 16), "cup")


# ---------- names and merge keys ----------

@pytest.mark.parametrize("text, key", [
    ("tomatoes", "tomato"), ("Tomatoes, diced", "tomato"), ("onions, chopped", "onion"),
    ("small onion, finely chopped", "onion"), ("large eggs", "egg"), ("fresh coriander (cilantro)", "coriander"), ("salt to taste", "salt"),
    ("berries", "berry"), ("potatoes", "potato"), ("peaches", "peach"), ("leaves", "leaf"),
    ("cookies", "cookie"), ("hummus", "hummus"), ("molasses", "molasses"), ("plain yogurt", "yogurt"),
    ("of flour", "flour"), ("unsalted butter, melted", "unsalted butter"),
])
def test_merge_key(text, key):
    assert ing.merge_key(text) == key


@pytest.mark.parametrize("word, plural", [
    ("egg", "eggs"), ("tomato", "tomatoes"), ("berry", "berries"), ("peach", "peaches"),
    ("leaf", "leaves"), ("eggs", "eggs"), ("garlic", "garlic"), ("chili", "chilies"),
])
def test_pluralize(word, plural):
    assert ing.pluralize(word) == plural


def test_display_name_matches_quantity():
    assert ing.display_name("onion", Fraction(3), None) == "onions"
    assert ing.display_name("eggs", Fraction(1), None) == "egg"
    assert ing.display_name("tomatoes", Fraction(2), "can") == "tomatoes"
    assert ing.display_name("salt", None, None) == "salt"


def test_split_lines_drops_blanks_and_caps_count():
    assert ing.split_lines("2 eggs\n\n   \n1 cup milk\r\n") == ["2 eggs", "1 cup milk"]
    assert len(ing.split_lines("\n".join(f"{i} eggs" for i in range(1, 200)))) == ing.MAX_LINES
    assert len(ing.split_lines("x" * 500)[0]) == ing.MAX_LINE_LENGTH


# ---------- aisles ----------

@pytest.mark.parametrize("key, unit, aisle", [
    ("onion", None, "Produce"), ("garlic", "clove", "Produce"), ("bell pepper", None, "Produce"),
    ("egg", None, "Dairy & Eggs"), ("milk", "cup", "Dairy & Eggs"), ("butter", "tbsp", "Dairy & Eggs"),
    ("peanut butter", None, "Pantry"), ("coconut milk", None, "Pantry"), ("chicken stock", None, "Pantry"),
    ("chicken thigh", "g", "Meat & Seafood"), ("ground beef", None, "Meat & Seafood"),
    ("bread", None, "Bakery"), ("flour", "cup", "Pantry"), ("baking powder", "tsp", "Pantry"),
    ("salt", "tsp", "Spices"), ("black pepper", None, "Spices"), ("garlic powder", None, "Spices"),
    ("ground ginger", None, "Spices"), ("frozen pea", None, "Frozen"), ("tomato", "can", "Pantry"),
    ("tomato", None, "Produce"), ("water", None, "Other"),
])
def test_aisle_for(key, unit, aisle):
    assert ing.aisle_for(key, unit) == aisle


def test_aisle_order_follows_store_layout():
    ordered = sorted(["Other", "Spices", "Produce", "Unknown", "Dairy & Eggs"], key=ing.aisle_order)
    assert ordered == ["Produce", "Dairy & Eggs", "Spices", "Other", "Unknown"]


# ---------- non-AI fallbacks ----------

@pytest.mark.parametrize("text, category", [
    ("Banana Pancakes", "Breakfast"), ("Masala omelette", "Breakfast"),
    ("Chocolate chip cookies", "Dessert"), ("Apple crumble", "Dessert"), ("Chicken curry", "Dinner"),
])
def test_guess_category(text, category):
    assert ing.guess_category(text) == category


def test_parse_recipe_text_with_headers():
    result = ing.parse_recipe_text(
        "Title: Banana Pancakes\nPrep time: 15 minutes\n\nIngredients:\n- 2 ripe bananas\n- 1 cup flour\n"
        "- salt to taste\n\nMethod\n1. Mash the bananas\n2. Cook for 3 minutes"
    )
    assert result == {
        "title": "Banana Pancakes", "prep_time": 15, "category": "Breakfast",
        "ingredients": ["2 ripe bananas", "1 cup flour", "salt to taste"],
    }


def test_parse_recipe_text_without_headers_uses_quantity_lines():
    result = ing.parse_recipe_text("Quick Dal\nReady in 1 hour\n1 cup lentils\n2 cups water\nBoil until soft.")
    assert result["title"] == "Quick Dal"
    assert result["prep_time"] == 60
    assert result["ingredients"] == ["1 cup lentils", "2 cups water"]
    assert result["category"] == "Dinner"


def test_parse_recipe_text_prefers_the_prep_time_over_cooking_times():
    text = "Pain à la banane\nPréparation : 15 min\nIngredients:\n- 3 bananas\nMethod\nBake 60 minutes."
    assert ing.parse_recipe_text(text)["prep_time"] == 15
    assert ing.parse_recipe_text("Soup\n1 onion\nSimmer 20 min, then rest 1 hour")["prep_time"] == 20
    assert ing.parse_recipe_text("Stew\nCook 2 hours\nPrep 30 minutes\n1 onion")["prep_time"] == 30


def test_parse_recipe_text_handles_garbage():
    assert ing.parse_recipe_text("")["ingredients"] == []
    assert ing.parse_recipe_text("just some words")["ingredients"] == []


def test_keyword_diet_tags():
    assert ing.keyword_diet_tags(["2 cups flour", "2 eggs", "1/2 cup walnuts"]) == [
        "vegetarian", "dairy-free", "contains nuts"]
    assert ing.keyword_diet_tags(["1 cup rice", "1 can coconut milk", "1 tbsp peanut butter"]) == [
        "vegetarian", "vegan", "gluten-free", "dairy-free", "contains nuts"]
    assert ing.keyword_diet_tags(["500 g chicken thighs", "1 cup yogurt"]) == ["gluten-free"]
    assert "contains nuts" not in ing.keyword_diet_tags(["1 tsp nutmeg", "1 cup eggplant"])
    assert "gluten-free" in ing.keyword_diet_tags(["1 cup almond flour"])


def test_basic_substitutes():
    assert ing.basic_substitutes("3 tbsp unsalted butter, melted")[0]["swap"].startswith("Oil")
    assert ing.basic_substitutes("2 large eggs")
    assert ing.basic_substitutes("1 cup water") == []
