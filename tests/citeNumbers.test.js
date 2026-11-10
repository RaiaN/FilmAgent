/**
 * @jest-environment node
 */
// CITATIONS: prompts cite by name; the numbers the model reads are made from the render's own lists.
import { citeNumbers } from '../utils/film/tools';

const plates = { Andre: 'a', Sam: 's', Campsite: 'c', Dave: 'd' };
const resolve = (word) => { if (!plates[word]) throw new Error(`No ${word}`); return { id: plates[word], name: word }; };
const images = [{ id: 'a' }, { id: 's' }, { id: 'c' }];

describe('citeNumbers', () => {
  test('names become the numbers of this render', () => {
    expect(citeNumbers('@Andre hands @Sam the maul at @Campsite.', resolve, { images })).toBe('@Image1 hands @Image2 the maul at @Image3.');
  });
  test('an unused-assets line naming someone outside the render goes, and the rest stays', () => {
    const out = citeNumbers('@Andre at @Campsite.\n\n【Unused Assets】\n@Dave does not appear in this scene and is not used.\n\n【Event Script】\n@Andre swings.', resolve, { images });
    expect(out).toBe('@Image1 at @Image3.\n\n【Event Script】\n@Image1 swings.');
  });
  test('an unused-assets line about a reference of the render stays', () => {
    const out = citeNumbers('【Unused Assets】\n@Sam is not used for the scene.\n【Event Script】\n@Andre swings.', resolve, { images });
    expect(out).toBe('【Unused Assets】\n@Image2 is not used for the scene.\n【Event Script】\n@Image1 swings.');
  });
  test('outside that section, citing someone not in the render is still refused', () => {
    expect(() => citeNumbers('@Dave watches @Andre.', resolve, { images })).toThrow('not a reference of this render');
  });
});
