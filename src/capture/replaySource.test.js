import { describe, expect, it } from "vitest";
import { naturalCompare, sortImages } from "./replaySource.js";

describe("replay ordering", () => {
  it("sorts numbers by value, not character by character", () => {
    expect(["shot10.png", "shot2.png", "Shot1.png"].sort(naturalCompare)).toEqual(["Shot1.png", "shot2.png", "shot10.png"]);
  });

  it("keeps only images", () => {
    const files = [
      new File([""], "b.png", { type: "image/png" }),
      new File([""], "notes.txt", { type: "text/plain" }),
      new File([""], "a.jpg", { type: "image/jpeg" }),
      new File([""], "c.webp"), // no type: fall back to the extension
      new File([""], "truth.json"),
    ];
    expect(sortImages(files).map((f) => f.name)).toEqual(["a.jpg", "b.png", "c.webp"]);
  });
});
