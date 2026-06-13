const fs = require('fs');
const path = require('path');

function writeWav(filename, sampleRate, samples) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); 
  buffer.writeUInt16LE(1, 20);  
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    let val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.floor(val), 44 + i * 2);
  }

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filename, buffer);
  console.log('Created ' + filename);
}

function generateKnock() {
  const sampleRate = 44100;
  const duration = 0.5;
  const totalSamples = sampleRate * duration;
  const samples = new Float32Array(totalSamples);

  function addKnock(startTime) {
    const startSample = Math.floor(startTime * sampleRate);
    for (let i = 0; i < sampleRate * 0.15; i++) {
      if (startSample + i >= totalSamples) break;
      const t = i / sampleRate;
      const env = Math.exp(-t * 30);
      let val = Math.sin(2 * Math.PI * 180 * t) * env;
      val += Math.sin(2 * Math.PI * 100 * t) * env * 0.5;
      const noiseEnv = Math.exp(-t * 200);
      val += (Math.random() * 2 - 1) * noiseEnv * 1.5;
      samples[startSample + i] += val;
    }
  }

  addKnock(0.0);
  addKnock(0.12);

  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > max) max = Math.abs(samples[i]);
  }
  if (max > 0) {
    for (let i = 0; i < samples.length; i++) samples[i] *= (0.8 / max);
  }

  writeWav('public/sounds/call.wav', sampleRate, samples);
}

generateKnock();
