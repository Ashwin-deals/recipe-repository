import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeRecipe } from "../test/fixtures";
import { RecipeCover } from "./RecipeCover";

describe("RecipeCover", () => {
  it("draws the initial in its own scalable box, inside the frame", () => {
    const { container } = render(<RecipeCover recipe={makeRecipe({ title: "Warm Apple Crumble" })} />);
    const letter = container.querySelector(".cover-letter");
    expect(letter).toHaveTextContent("W");
    const box = letter?.parentElement;
    expect(box?.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(box?.getAttribute("preserveAspectRatio")).toMatch(/ meet$/);
    expect(container.querySelector(".cover-label")).toHaveTextContent("Breakfast");
    expect(container.querySelector(".cover")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the same art every time for the same recipe", () => {
    const recipe = makeRecipe({ id: 7, title: "Masala Omelette" });
    const first = render(<RecipeCover recipe={recipe} />).container.querySelector(".cover");
    const second = render(<RecipeCover recipe={recipe} />).container.querySelector(".cover");
    expect(first?.getAttribute("data-pattern")).toBe(second?.getAttribute("data-pattern"));
    expect(first?.querySelector("rect")?.getAttribute("fill")).toBe(second?.querySelector("rect")?.getAttribute("fill"));
  });

  it("gives two covers on one page unique pattern ids", () => {
    const { container } = render(
      <>
        <RecipeCover recipe={makeRecipe({ id: 1 })} />
        <RecipeCover recipe={makeRecipe({ id: 1 })} />
      </>,
    );
    const ids = [...container.querySelectorAll("pattern, filter")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows an uploaded photo instead of the art, with the label on top", () => {
    const { container } = render(<RecipeCover recipe={makeRecipe({ photo_url: "/photos/1.jpg" })} />);
    const img = container.querySelector("img.cover-photo");
    expect(img).toHaveAttribute("src", "/photos/1.jpg");
    expect(container.querySelector(".cover-art")).toBeNull();
    expect(container.querySelector(".cover-label")).toHaveTextContent("Breakfast");
  });
});
