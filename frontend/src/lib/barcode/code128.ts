// Minimal Code 128 (subset B) encoder — no dependency. Used for the secondary linear barcode under the
// customer's QR. The value encoded is only the public CUP code (upper-case letters, digits and '-', all of
// which subset B covers). Returns run-lengths so any renderer can draw it; see Code128Barcode.tsx.

// Bar/space width patterns for symbol values 0..106 (six elements bar,space,bar,space,bar,space; the stop
// symbol has seven). Index = Code 128 symbol value.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export class Code128Error extends Error {}

// Returns the alternating run lengths (in modules) starting with a BAR, including start, checksum and stop.
export function encodeCode128B(text: string): number[] {
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Code128Error(`Character not supported by Code 128 subset B: ${ch}`);
    values.push(code - 32);
  }
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);
  return values.flatMap((value) => PATTERNS[value].split('').map(Number));
}

// Total width in modules (excluding quiet zones).
export function totalModules(runs: number[]): number {
  return runs.reduce((sum, run) => sum + run, 0);
}
