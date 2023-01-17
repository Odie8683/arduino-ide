import { expect } from 'chai';
import { Sketch } from '../../common/protocol';

describe('sketch', () => {
  describe('validateSketchFolderName', () => {
    (
      [
        ['sketch', true],
        ['can-contain-slash-and-dot.ino', true],
        ['regex++', false],
        ['dots...', true],
        ['No Spaces', false],
        ['_invalidToStartWithUnderscore', false],
        ['Invalid+Char.ino', false],
        ['', false],
        ['/', false],
        ['//trash/', false],
        [
          '63Length_012345678901234567890123456789012345678901234567890123',
          true,
        ],
        [
          'TooLong__0123456789012345678901234567890123456789012345678901234',
          false,
        ],
      ] as [string, boolean][]
    ).map(([input, expected]) => {
      it(`'${input}' should ${
        !expected ? 'not ' : ''
      }be a valid sketch folder name`, () => {
        const actual = Sketch.validateSketchFolderName(input);
        if (expected) {
          expect(actual).to.be.undefined;
        } else {
          expect(actual).to.be.not.undefined;
          expect(actual?.length).to.be.greaterThan(0);
        }
      });
    });
  });

  describe('validateCloudSketchFolderName', () => {
    (
      [
        ['sketch', true],
        ['no-dashes', false],
        ['no-dots', false],
        ['No Spaces', false],
        ['_canStartWithUnderscore', true],
        ['Invalid+Char.ino', false],
        ['', false],
        ['/', false],
        ['//trash/', false],
        ['36Length_012345678901234567890123456', true],
        ['TooLong__0123456789012345678901234567', false],
      ] as [string, boolean][]
    ).map(([input, expected]) => {
      it(`'${input}' should ${
        !expected ? 'not ' : ''
      }be a valid cloud sketch folder name`, () => {
        const actual = Sketch.validateCloudSketchFolderName(input);
        if (expected) {
          expect(actual).to.be.undefined;
        } else {
          expect(actual).to.be.not.undefined;
          expect(actual?.length).to.be.greaterThan(0);
        }
      });
    });
  });

  describe('toValidSketchFolderName', () => {
    [
      ['', Sketch.defaultSketchFolderName],
      [' ', Sketch.defaultFallbackFirstChar],
      ['  ', Sketch.defaultFallbackFirstChar + Sketch.defaultFallbackChar],
      [
        '0123456789012345678901234567890123456789012345678901234567890123',
        '012345678901234567890123456789012345678901234567890123456789012',
      ],
      ['foo bar', 'foo_bar'],
      ['vAlid', 'vAlid'],
    ].map(([input, expected]) =>
      toMapIt(input, expected, Sketch.toValidSketchFolderName)
    );
  });

  describe('toValidSketchFolderName with timestamp suffix', () => {
    const epoch = new Date(0);
    const epochSuffix = Sketch.timestampSuffix(epoch);
    [
      ['', Sketch.defaultSketchFolderName + epochSuffix],
      [' ', Sketch.defaultFallbackFirstChar + epochSuffix],
      [
        '  ',
        Sketch.defaultFallbackFirstChar +
          Sketch.defaultFallbackChar +
          epochSuffix,
      ],
      [
        '0123456789012345678901234567890123456789012345678901234567890123',
        '0123456789012345678901234567890123456789012' + epochSuffix,
      ],
      ['foo bar', 'foo_bar' + epochSuffix],
      ['vAlid', 'vAlid' + epochSuffix],
    ].map(([input, expected]) =>
      toMapIt(input, expected, (input: string) =>
        Sketch.toValidSketchFolderName(input, epoch)
      )
    );
  });

  describe('toValidCloudSketchFolderName', () => {
    [
      ['sketch', 'sketch'],
      ['can-contain-slash-and-dot.ino', 'can_contain_slash_and_dot_ino'],
      ['regex++', 'regex__'],
      ['dots...', 'dots___'],
      ['No Spaces', 'No_Spaces'],
      ['_startsWithUnderscore', '_startsWithUnderscore'],
      ['Invalid+Char.ino', 'Invalid_Char_ino'],
      ['', 'sketch'],
      ['/', '_'],
      ['//trash/', '__trash_'],
      [
        '63Length_012345678901234567890123456789012345678901234567890123',
        '63Length_012345678901234567890123456',
      ],
    ].map(([input, expected]) =>
      toMapIt(input, expected, Sketch.toValidCloudSketchFolderName, true)
    );
  });
});

function toMapIt(
  input: string,
  expected: string,
  testMe: (input: string) => string,
  cloud = false
): Mocha.Test {
  return it(`should map the '${input}' ${
    cloud ? 'cloud ' : ''
  }sketch folder name to '${expected}'`, () =>
    expect(testMe(input)).to.be.equal(expected));
}
