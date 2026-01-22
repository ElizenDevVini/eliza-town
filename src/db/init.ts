import 'dotenv/config';
import { initializeDatabase, query } from './index.js';
import { ELIZA_TOWN_CHARACTERS } from '../eliza/characters.js';
import pool from './index.js';

async function init(): Promise<void> {
  console.log('Initializing Eliza Town database with ElizaOS characters...');

  try {
    // Create schema
    await initializeDatabase();
    console.log('Schema created successfully');

    // Check if agents exist
    const result = await query<{ count: string }>('SELECT COUNT(*) FROM agents');
    const agentCount = parseInt(result.rows[0].count);

    if (agentCount === 0) {
      console.log('Seeding agents from ElizaOS characters...');

      for (const character of ELIZA_TOWN_CHARACTERS) {
        await query(
          `INSERT INTO agents (name, type, model_id, personality, capabilities)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            character.name,
            character.role,
            character.modelId,
            character.adjectives?.join(', ') || 'helpful',
            character.capabilities?.join(', ') || 'general'
          ]
        );
        console.log(`  Created agent: ${character.name} (${character.role})`);
      }

      console.log(`Seeded ${ELIZA_TOWN_CHARACTERS.length} agents`);
    } else {
      console.log(`Database already has ${agentCount} agents`);
    }

    console.log('Database initialization complete!');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
