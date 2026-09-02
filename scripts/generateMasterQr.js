const path = require('path');
const QRCode = require('qrcode');

const masterConfig = {
  v: 1,
  masterId: 3,
  bleName: 'DogGPS-Master3',
  serviceUuid: '7f510001-6d9e-4e2f-a671-8f3f2d49a001',
  profile: 'default',
};

const payload = JSON.stringify(masterConfig);
const outputPath = path.resolve(__dirname, '..', 'DogGPS-Master3-QR.png');

async function generateMasterQr() {
  await QRCode.toFile(outputPath, payload, {
    type: 'png',
    width: 800,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  console.log(`Master QR Code generated: ${outputPath}`);
  console.log(`Payload: ${payload}`);
}

generateMasterQr().catch(error => {
  console.error('Failed to generate Master QR Code:', error);
  process.exitCode = 1;
});
