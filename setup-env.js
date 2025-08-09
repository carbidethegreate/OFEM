/* OnlyFans Express Messenger (OFEM)
   File: setup-env.js
   Purpose: Wizard to collect API keys and create .env file
   Created: 2025-08-05 – v1.0
*/

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function main() {
  const envPath = path.join(__dirname, '.env');
  const exampleEnvPath = path.join(__dirname, '.env.example');

  // Ensure .env exists, copying from example if available
  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(exampleEnvPath)) {
      fs.copyFileSync(exampleEnvPath, envPath);
    } else {
      fs.writeFileSync(envPath, '');
    }
  }

  let envContent = fs.readFileSync(envPath, 'utf8');

  let onlyfansKey = '';
  while (!onlyfansKey) {
    onlyfansKey = await prompt('Enter your OnlyFans API Key (required): ');
    if (!onlyfansKey)
      console.log(
        'ONLYFANS_API_KEY is required to make OnlyFans API requests.',
      );
  }
  let openaiKey = '';
  while (!openaiKey) {
    openaiKey = await prompt('Enter your OpenAI API Key (required): ');
    if (!openaiKey)
      console.log('OPENAI_API_KEY is required for OpenAI functionality.');
  }

  const dbName = await prompt(
    'Enter your Database Name (optional, leave blank to skip): ',
  );
  let dbUser = '';
  let dbPassword = '';
  let dbHost = '';
  let dbPort = '';
  if (dbName) {
    while (!dbUser) {
      dbUser = await prompt('Enter your Database User (required): ');
      if (!dbUser) console.log('Database user is required.');
    }
    while (!dbPassword) {
      dbPassword = await prompt('Enter your Database Password (required): ');
      if (!dbPassword) console.log('Database password is required.');
    }
    while (!dbHost) {
      dbHost = await prompt('Enter your Database Host (required): ');
      if (!dbHost) console.log('Database host is required.');
    }
    while (true) {
      dbPort = await prompt('Enter your Database Port (required): ');
      if (!dbPort) {
        console.log('Database port is required.');
      } else if (Number.isNaN(Number(dbPort))) {
        console.log('Database port must be a number.');
        dbPort = '';
      } else {
        break;
      }
    }
  }
  const dbAdminUser = await prompt(
    'Enter your Database Admin User (optional, leave blank to skip): ',
  );
  const dbAdminPassword = await prompt(
    'Enter your Database Admin Password (optional, leave blank to skip): ',
  );
  const port = await prompt(
    'Enter Express server port (leave blank for 3000): ',
  );
  const fetchLimit = await prompt(
    'Max OnlyFans records to fetch (leave blank for 1000): ',
  );

  const requiredVars = {
    ONLYFANS_API_KEY: onlyfansKey,
    OPENAI_API_KEY: openaiKey,
  };
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value) {
      console.error(`${key} is required. Aborting setup.`);
      process.exit(1);
    }
  }

  const setEnv = (key, value) => {
    if (!value) return;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  };

  setEnv('ONLYFANS_API_KEY', onlyfansKey);
  setEnv('OPENAI_API_KEY', openaiKey);
  if (dbName) {
    setEnv('DB_NAME', dbName);
    setEnv('DB_USER', dbUser);
    setEnv('DB_PASSWORD', dbPassword);
    setEnv('DB_HOST', dbHost);
    setEnv('DB_PORT', dbPort);
  } else {
    // Remove any existing DB_* entries to allow fresh setup
    envContent = envContent
      .split(/\r?\n/)
      .filter(
        (line) =>
          !line.startsWith('DB_NAME=') &&
          !line.startsWith('DB_USER=') &&
          !line.startsWith('DB_PASSWORD=') &&
          !line.startsWith('DB_HOST=') &&
          !line.startsWith('DB_PORT='),
      )
      .join('\n');
  }
  setEnv('DB_ADMIN_USER', dbAdminUser);
  setEnv('DB_ADMIN_PASSWORD', dbAdminPassword);
  setEnv('PORT', port || '3000');
  setEnv('OF_FETCH_LIMIT', fetchLimit);
  if (!envContent.endsWith('\n')) envContent += '\n';
  fs.writeFileSync(envPath, envContent);
  console.log('.env file created/updated.');
  if (dbName) {
    console.log(
      'API keys and database credentials saved. Server port set (default 3000).',
    );
  } else {
    console.log('API keys saved. No database credentials provided.');
  }
  console.log('Next run `npm run setup-db` to set up the database.');
}

main();

/* End of File – Last modified 2025-08-05 */
