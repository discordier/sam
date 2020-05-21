import {
  sampledConsonantValues0,
  sampleTable
} from './tables.es6';

import {BREAK, END} from '../common/constants.es6'

import SetMouthThroat from './set-mouth-throat.es6'
import CreateTransitions from './create-transitions.es6';
import CreateFrames from './create-frames.es6';
import CreateOutputBuffer from './output-buffer.es6';
/**
 * @param {Array} phonemes
 * @param {Number} [pitch]
 * @param {Number} [mouth]
 * @param {Number} [throat]
 * @param {Number} [speed]
 * @param {Boolean} [singmode]
 *
 * @return Uint8Array
 */
export default function Renderer(phonemes, pitch, mouth, throat, speed, singmode) {
  pitch = (pitch === undefined) ? 64 : pitch & 0xFF;
  mouth = (mouth === undefined) ? 128 : mouth & 0xFF;
  throat = (throat === undefined) ? 128 : throat & 0xFF;
  speed = (speed || 72) & 0xFF;
  singmode = singmode || false;

  // Every frame is 20ms long.
  const Output = CreateOutputBuffer(
    441 // = (22050/50)
    * phonemes.reduce((pre, v) => pre + (v[1] * 20), 0) / 50 // Combined phoneme length in ms.
    * speed | 0 // multiplied by speed.
  );

  const freqdata = SetMouthThroat(mouth, throat);

  // Main render loop.
  let srcpos  = 0; // Position in source
  // FIXME: should be tuple buffer as well.
  let tuples = [];
  while(1) {
    const A = phonemes[srcpos];
    const A0 = A[0]
    if (A0) {
      if (A0 === END) {
        Render(tuples);
        return Output.get();
      }
      if (A0 === BREAK) {
        Render(tuples);
        tuples = [];
      } else {
        tuples.push(A);
      }
    }
    ++srcpos;
  }

  /**
   * RENDER THE PHONEMES IN THE LIST
   *
   * The phoneme list is converted into sound through the steps:
   *
   * 1. Copy each phoneme <length> number of times into the frames list,
   *    where each frame represents 10 milliseconds of sound.
   *
   * 2. Determine the transitions lengths between phonemes, and linearly
   *    interpolate the values across the frames.
   *
   * 3. Offset the pitches by the fundamental frequency.
   *
   * 4. Render the each frame.
   *
   * @param {Array} tuples
   */
  function Render (tuples) {
    if (tuples.length === 0) {
      return; //exit if no data
    }

    const [pitches, frequency, amplitude, sampledConsonantFlag] = CreateFrames(
      pitch,
      tuples,
      freqdata
    );

    const t = CreateTransitions(
      pitches,
      frequency,
      amplitude,
      tuples
    );

    if (!singmode) {
      /* ASSIGN PITCH CONTOUR
       *
       * This subtracts the F1 frequency from the pitch to create a
       * pitch contour. Without this, the output would be at a single
       * pitch level (monotone).
       */
      for(let i = 0; i < pitches.length; i++) {
        // subtract half the frequency of the formant 1.
        // this adds variety to the voice
        pitches[i] -= (frequency[0][i] >> 1);
      }
    }

    /*
     * RESCALE AMPLITUDE
     *
     * Rescale volume from a linear scale to decibels.
     */
    const amplitudeRescale = [
      0x00, 0x01, 0x02, 0x02, 0x02, 0x03, 0x03, 0x04,
      0x04, 0x05, 0x06, 0x08, 0x09, 0x0B, 0x0D, 0x0F,
      0x00  //17 elements?
    ];
    for(let i = amplitude[0].length - 1; i >= 0; i--) {
      amplitude[0][i] = amplitudeRescale[amplitude[0][i]];
      amplitude[1][i] = amplitudeRescale[amplitude[1][i]];
      amplitude[2][i] = amplitudeRescale[amplitude[2][i]];
    }

    if (process.env.DEBUG_SAM === true) {
      PrintOutput(pitches, frequency, amplitude, sampledConsonantFlag);
    }
    if (process.env.NODE_ENV === 'karma-test') {
      // Karma run, store data for karma retrieval.
      Renderer.karmaOutput = {
        sampledConsonantFlag: sampledConsonantFlag,
        amplitude1: amplitude[0],
        frequency1: frequency[0],
        amplitude2: amplitude[1],
        frequency2: frequency[1],
        amplitude3: amplitude[2],
        frequency3: frequency[2],
        pitches: pitches,
        freq1data: freqdata[0],
        freq2data: freqdata[1],
        freq3data: freqdata[2],
      };
    }

    ProcessFrames(t, speed, frequency, pitches, amplitude, sampledConsonantFlag);
  }

  /**
   * PROCESS THE FRAMES
   *
   * In traditional vocal synthesis, the glottal pulse drives filters, which
   * are attenuated to the frequencies of the formants.
   *
   * SAM generates these formants directly with sine and rectangular waves.
   * To simulate them being driven by the glottal pulse, the waveforms are
   * reset at the beginning of each glottal pulse.
   */
  function ProcessFrames(frameCount, speed, frequency, pitches, amplitude, sampledConsonantFlag) {
    const RenderSample = (lastSampleOffset, consonantFlag, mem49) => {
      // mem49 == current phoneme's index - unsigned char

      // mask low three bits and subtract 1 get value to
      // convert 0 bits on unvoiced samples.
      const kind = (consonantFlag & 7) - 1;

      // determine which value to use from table { 0x18, 0x1A, 0x17, 0x17, 0x17 }
      // T', S, Z               0          0x18
      // CH', J', SH, ZH        1          0x1A
      // P', F, V, TH, DH       2          0x17
      // /H                     3          0x17
      // /X                     4          0x17

      const samplePage = kind * 256 & 0xFFFF; // unsigned short
      let off = consonantFlag & 248; // unsigned char

      function renderSample (index1, value1, index0, value0) {
        let bit = 8;
        let sample = sampleTable[samplePage+off]
        do {
          if ((sample & 128) !== 0) {
            Output(index1, value1);
          } else {
            Output(index0, value0);
          }
          sample <<= 1;
        } while(--bit);
      }

      if(off === 0) {
        // voiced phoneme: Z*, ZH, V*, DH
        let phase1 = (pitches[mem49 & 0xFF] >> 4) ^ 255 & 0xFF; // unsigned char
        off = lastSampleOffset & 0xFF; // unsigned char
        do {
          renderSample(3, 26, 4, 6)
          off++;
          off &= 0xFF;
        } while (++phase1 & 0xFF);
        return off;
      }
      // unvoiced
      off = off ^ 255 & 0xFF; // unsigned char
      const value0 = sampledConsonantValues0[kind] & 0xFF; // unsigned char
      do {
        renderSample(2, 5, 1, value0)
      } while (++off & 0xFF);

      return lastSampleOffset;
    };

    // Removed sine table stored a pre calculated sine wave but in modern CPU, we can calculate inline.
    const sinus = (x) => {
      return ((Math.sin(
        (2*Math.PI)*
        (x/255)
      )*128 | 0)/16|0)*16;
    }

    let speedcounter = speed;
    let phase1 = 0;
    let phase2 = 0;
    let phase3 = 0;
    let lastSampleOffset = 0;
    let pos = 0;
    let glottal_pulse = pitches[0];
    let mem38 = glottal_pulse * .75 |0;

    while(frameCount) {
      const flags = sampledConsonantFlag[pos];

      // unvoiced sampled phoneme?
      if ((flags & 248) !== 0) {
        lastSampleOffset = RenderSample(lastSampleOffset, flags, pos);
        // skip ahead two in the phoneme buffer
        pos += 2;
        frameCount -= 2;
        speedcounter = speed;
      } else {
        {
          // Rectangle wave consisting of:
          //   0-128 = 0x90
          // 128-255 = 0x70

          // simulate the glottal pulse and formants
          const ary = []
          let /* unsigned int */ p1 = phase1 * 256; // Fixed point integers because we need to divide later on
          let /* unsigned int */ p2 = phase2 * 256;
          let /* unsigned int */ p3 = phase3 * 256;
          for (let k=0; k<5; k++) {
            const /* signed char */ sp1 = sinus(0xff & (p1>>8));
            const /* signed char */ sp2 = sinus(0xff & (p2>>8));
            const /* signed char */ rp3 = ((0xff & (p3>>8))<129) ? -0x70 : 0x70;
            const /* signed int */ sin1 = sp1 * (/* (unsigned char) */ amplitude[0][pos] & 0x0F);
            const /* signed int */ sin2 = sp2 * (/* (unsigned char) */ amplitude[1][pos] & 0x0F);
            const /* signed int */ rect = rp3 * (/* (unsigned char) */ amplitude[2][pos] & 0x0F);
            let /* signed int */ mux = sin1 + sin2 + rect;
            mux /= 32;
            mux += 128; // Go from signed to unsigned amplitude
            ary[k] = mux |0;
            p1 += frequency[0][pos] * 256 / 4; // Compromise, this becomes a shift and works well
            p2 += frequency[1][pos] * 256 / 4;
            p3 += frequency[2][pos] * 256 / 4;
          }
          Output.ary(0, ary);
        }

        speedcounter--;
        if (speedcounter === 0) {
          pos++; //go to next amplitude
          // decrement the frame count
          frameCount--;
          if(frameCount === 0) {
            return;
          }
          speedcounter = speed;
        }

        glottal_pulse--;

        if(glottal_pulse !== 0) {
          // not finished with a glottal pulse

          mem38--;
          // within the first 75% of the glottal pulse?
          // is the count non-zero and the sampled flag is zero?
          if((mem38 !== 0) || (flags === 0)) {
            // update the phase of the formants
            // TODO: we should have a switch to disable this, it causes a pretty nice voice without the masking!
            phase1 = phase1 + frequency[0][pos]; // & 0xFF;
            phase2 = phase2 + frequency[1][pos]; // & 0xFF;
            phase3 = phase3 + frequency[2][pos]; // & 0xFF;
            continue;
          }

          // voiced sampled phonemes interleave the sample with the
          // glottal pulse. The sample flag is non-zero, so render
          // the sample for the phoneme.
          lastSampleOffset = RenderSample(lastSampleOffset, flags, pos);
        }
      }

      glottal_pulse = pitches[pos];
      mem38 = glottal_pulse * .75 |0;

      // reset the formant wave generators to keep them in
      // sync with the glottal pulse
      phase1 = 0;
      phase2 = 0;
      phase3 = 0;
    }
  }
}

function PrintOutput(pitches, frequency, amplitude, sampledConsonantFlag) {
  function pad(num) {
    const s = '00000' + num;
    return s.substr(s.length - 5);
  }
  console.log('===========================================');
  console.log('Final data for speech output:');
  console.log(' flags ampl1 freq1 ampl2 freq2 ampl3 freq3 pitch');
  console.log('------------------------------------------------');
  for (let i=0;i<sampledConsonantFlag.length;i++) {
    console.log(
      ' %s %s %s %s %s %s %s %s',
      pad(sampledConsonantFlag[i]),
      pad(amplitude[0][i]),
      pad(frequency[0][i]),
      pad(amplitude[1][i]),
      pad(frequency[1][i]),
      pad(amplitude[2][i]),
      pad(frequency[2][i]),
      pad(pitches[i])
    );
    i++;
  }
  console.log('===========================================');
}
