import { describe, expect, it } from 'vitest';
import { rewriteAstroRefs } from './sync-variants.mjs';

const BLOB = 'https://example.blob.core.windows.net/variants/';
const files = ['DSC00484.D0sZrV9Z_ZQkrNW.webp', 'kelp.CGbFu5hM_ZdO5pD.jpeg'];

describe('rewriteAstroRefs', () => {
  it('rewrites a plain src', () => {
    expect(
      rewriteAstroRefs('<img src="/_astro/DSC00484.D0sZrV9Z_ZQkrNW.webp">', files, BLOB),
    ).toBe(`<img src="${BLOB}DSC00484.D0sZrV9Z_ZQkrNW.webp">`);
  });

  it('rewrites every entry in a srcset', () => {
    const html =
      '<img srcset="/_astro/DSC00484.D0sZrV9Z_ZQkrNW.webp 900w, /_astro/kelp.CGbFu5hM_ZdO5pD.jpeg 1600w">';
    const out = rewriteAstroRefs(html, files, BLOB);
    expect(out).not.toContain('/_astro/');
    expect(out).toContain(`${BLOB}DSC00484.D0sZrV9Z_ZQkrNW.webp 900w`);
    expect(out).toContain(`${BLOB}kelp.CGbFu5hM_ZdO5pD.jpeg 1600w`);
  });

  it('rewrites URLs inside an attribute holding escaped JSON', () => {
    // This is the shape the rotating lead photograph emits. The old pattern ran
    // past the filename into `&#34;` and left the reference untouched.
    const html =
      '<section data-lead="[{&#34;src&#34;:&#34;/_astro/DSC00484.D0sZrV9Z_ZQkrNW.webp&#34;,&#34;n&#34;:1}]">';
    const out = rewriteAstroRefs(html, files, BLOB);
    expect(out).toContain(`${BLOB}DSC00484.D0sZrV9Z_ZQkrNW.webp&#34;`);
    expect(out).not.toContain('/_astro/');
  });

  it('rewrites a CSS url()', () => {
    expect(rewriteAstroRefs('a{background:url(/_astro/kelp.CGbFu5hM_ZdO5pD.jpeg)}', files, BLOB))
      .toBe(`a{background:url(${BLOB}kelp.CGbFu5hM_ZdO5pD.jpeg)}`);
  });

  it('leaves references it has not uploaded alone', () => {
    const html = '<img src="/_astro/not-uploaded.abc123.webp">';
    expect(rewriteAstroRefs(html, files, BLOB)).toBe(html);
  });

  it('leaves non-image assets alone', () => {
    const html = '<script src="/_astro/client.DEf456.js"></script>';
    expect(rewriteAstroRefs(html, files, BLOB)).toBe(html);
  });
});
