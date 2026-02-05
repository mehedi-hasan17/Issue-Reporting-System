const fs = require('fs');
const key = fs.readFileSync('./final-project-35eb1-firebase-adminsdk-fbsvc-aa7f9e78e7.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)