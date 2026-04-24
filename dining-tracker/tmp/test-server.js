const express = require('express');
const app = express();
const PORT = 3334;
app.get('/', (req, res) => res.send('OK'));
app.listen(PORT, () => console.log(`Test server on ${PORT}`));
