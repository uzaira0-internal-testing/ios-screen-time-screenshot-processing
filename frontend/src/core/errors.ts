export class DuplicateScreenshotError extends Error {
  constructor(public readonly existingId: number) {
    super(`Duplicate image: already uploaded as screenshot #${existingId}`);
    this.name = "DuplicateScreenshotError";
  }
}
