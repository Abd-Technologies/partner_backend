'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize'); // Destructure for convenience
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development'; // Get the current environment
const config = require(__dirname + '/../config/config.json')[env]; // Load the config for the current environment
const db = {};

let sequelize;

try {
  // Create a Sequelize instance based on the config
  if (config.use_env_variable) {
    sequelize = new Sequelize(process.env[config.use_env_variable], config);
  } else {
    sequelize = new Sequelize(config.database, config.username, config.password, {
      host: config.host,
      dialect: config.dialect,
      port: config.port || 3307, // Use 3306 as default unless overridden in the config
      logging: console.log, // Enable query logging (optional, for debugging)
    });
  }


  console.log('Database connection established successfully.');
} catch (error) {
  console.error('Unable to connect to the database:', error);
  process.exit(1); // Exit the process if the connection fails
}

// Read all model files and initialize them
fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, DataTypes);
    db[model.name] = model; // Add the model to the db object
  });

// Set up associations between models
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Attach sequelize instance and Sequelize constructor to the db object
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db; // Export the db object
