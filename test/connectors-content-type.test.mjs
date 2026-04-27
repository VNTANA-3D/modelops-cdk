import { contentTypeFor } from "../src/connectors/content-type.mjs";

describe("contentTypeFor", () => {
  it('returns "image/vnd.radiance" for ".hdr"', () => {
    expect(contentTypeFor("scene.hdr")).toBe("image/vnd.radiance");
  });

  it('returns "image/png" for uppercase ".PNG"', () => {
    expect(contentTypeFor("photo.PNG")).toBe("image/png");
  });

  it('returns "application/octet-stream" for an unknown extension', () => {
    expect(contentTypeFor("model.stl")).toBe("application/octet-stream");
  });

  it('returns "application/octet-stream" for a filename without a dot', () => {
    expect(contentTypeFor("README")).toBe("application/octet-stream");
  });
});
