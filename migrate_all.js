/* OnlyFans Express Messenger (OFEM)
   File: migrate_all.js
   Purpose: Run all database migration scripts sequentially
   Created: 2025-??-?? – v1.0
*/

const { spawnSync } = require('child_process');
const path = require('path');

const scripts = [
  'migrate_add_fan_fields.js',
  'migrate_messages.js',
  'migrate_scheduled_messages.js',
  'migrate_add_vault_lists.js',
  'migrate_add_ppv_tables.js',
  'migrate_add_ppv_schedule_fields.js',
  // PPV-related migrations
  'migrate_add_ppv_message_field.js',
  'migrate_add_ppv_sends.js',
];

for (const script of scripts) {
  console.log(`➡️  Running ${script}`);
  const result = spawnSync('node', [path.join(__dirname, script)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`❌ Migration failed for ${script}`);
    process.exit(result.status || 1);
  }
}

console.log('✅ All migrations complete.');

/* End of File – Last modified 2025-08-08 */
