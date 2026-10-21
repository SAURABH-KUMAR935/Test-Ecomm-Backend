const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '15d',
    jwtid: randomUUID(),
  });
};

module.exports = generateToken;
