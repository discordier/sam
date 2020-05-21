import {frequencyData} from './tables.es6';

function trans(factor, initialFrequency) {
  return (((factor * initialFrequency) >> 8) & 0xFF) << 1;
}

/**
 * SAM's voice can be altered by changing the frequencies of the
 * mouth formant (F1) and the throat formant (F2). Only the
 * vowel/diphthong and sonorant phonemes (5-29 and 48-53) are altered.
 *
 * This returns the three base frequency arrays.
 *
 * @param {Number} mouth  valid values: 0-255
 * @param {Number} throat valid values: 0-255
 *
 * @return {Array}
 */
export default function SetMouthThroat(mouth, throat) {
  const freqdata = [[],[],[]];
  frequencyData.map((v, i) => {
    freqdata[0][i] = v & 0xFF;
    freqdata[1][i] = (v >> 8) & 0xFF;
    freqdata[2][i] = (v >> 16) & 0xFF;
  });

  // recalculate formant frequencies 5..29 for the mouth (F1) and throat (F2)
  for(let pos = 5; pos < 30; pos++) {
    // recalculate mouth frequency
    freqdata[0][pos] = trans(mouth, freqdata[0][pos]);

    // recalculate throat frequency
    freqdata[1][pos] = trans(throat, freqdata[1][pos]);
  }

  // recalculate formant frequencies 48..53
  for(let pos = 48; pos < 54; pos++) {
    // recalculate F1 (mouth formant)
    freqdata[0][pos] = trans(mouth, freqdata[0][pos]);
    // recalculate F2 (throat formant)
    freqdata[1][pos] = trans(throat, freqdata[1][pos]);
  }

  return freqdata;
}
