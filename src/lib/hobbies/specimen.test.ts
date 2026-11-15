import { describe, expect, it } from "vitest";
import { largePhoto } from "./specimen";

describe("largePhoto", () => {
  it("swaps iNaturalist's 500 px copy for its 1024 px one", () => {
    expect(
      largePhoto(
        "https://inaturalist-open-data.s3.amazonaws.com/photos/129716838/medium.jpg",
      ),
    ).toBe(
      "https://inaturalist-open-data.s3.amazonaws.com/photos/129716838/large.jpg",
    );
    expect(
      largePhoto("https://static.inaturalist.org/photos/28938/medium.jpeg"),
    ).toBe("https://static.inaturalist.org/photos/28938/large.jpeg");
  });

  it("leaves any other photo as it is", () => {
    expect(
      largePhoto(
        "https://stphotoprodnowiur.blob.core.windows.net/hobby-media/herping/species/ensatina.jpg",
      ),
    ).toBeNull();
    expect(
      largePhoto(
        "https://inaturalist-open-data.s3.amazonaws.com/photos/129716838/large.jpg",
      ),
    ).toBeNull();
  });
});
