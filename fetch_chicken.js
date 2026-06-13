const https = require('https');
const fs = require('fs');

https.get('https://xeno-canto.org/api/2/recordings?query=chicken', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.recordings && parsed.recordings.length > 0) {
        let fileUrl = parsed.recordings[0].file;
        if (!fileUrl.startsWith('http')) fileUrl = 'https:' + fileUrl;
        console.log('Downloading chicken sound from: ' + fileUrl);
        
        const file = fs.createWriteStream('public/sounds/fold.mp3');
        https.get(fileUrl, (response) => {
          // Xeno canto often redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
             const redirect = response.headers.location;
             console.log('Redirecting to: ' + redirect);
             https.get(redirect, (res2) => {
                 res2.pipe(file);
                 file.on('finish', () => { file.close(); console.log('Downloaded fold.mp3'); });
             });
          } else {
             response.pipe(file);
             file.on('finish', () => { file.close(); console.log('Downloaded fold.mp3'); });
          }
        });
      }
    } catch(e) {
      console.error(e);
    }
  });
});
