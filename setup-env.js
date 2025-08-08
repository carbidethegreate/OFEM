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

  const onlyfansKey = await prompt(
    'Enter your OnlyFans API Key (leave blank to skip): ',
  );
  const openaiKey = await prompt(
    'Enter your OpenAI API Key (leave blank to skip): ',
  );

  const dbName = await prompt(
    'Enter your Database Name (leave blank to skip): ',
  );
  const dbUser = await prompt(
    'Enter your Database User (leave blank to skip): ',
  );
  const dbPassword = await prompt(
    'Enter your Database Password (leave blank to skip): ',
  );
  const dbHost = await prompt(
    'Enter your Database Host (leave blank to skip): ',
  );
  const dbPort = await prompt(
    'Enter your Database Port (leave blank to skip): ',
  );
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
  setEnv('DB_NAME', dbName);
  setEnv('DB_USER', dbUser);
  setEnv('DB_PASSWORD', dbPassword);
  setEnv('DB_HOST', dbHost);
  setEnv('DB_PORT', dbPort);
  setEnv('DB_ADMIN_USER', dbAdminUser);
  setEnv('DB_ADMIN_PASSWORD', dbAdminPassword);
  setEnv('PORT', port || '3000');
  setEnv('OF_FETCH_LIMIT', fetchLimit);
  if (!envContent.endsWith('\n')) envContent += '\n';
  fs.writeFileSync(envPath, envContent);
  console.log('.env file created/updated.');
  console.log(
    'API keys saved. Database credentials and server port saved (default 3000).',
  );
  console.log('Next run setup-db.command to create the database.');
}

main();

/* End of File – Last modified 2025-08-05 */
