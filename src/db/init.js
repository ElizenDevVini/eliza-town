import 'dotenv/config';
import { initializeDatabase, query } from './index.js';
import { DEFAULT_AGENTS } from '../agents/config.js';
import pool from './index.js';

async function init() {
  console.log('Initializing Eliza Town database...');

  try {
    // Create schema
    await initializeDatabase();
    console.log('Schema created successfully');

    // Check if agents exist
    const result = await query('SELECT COUNT(*) FROM agents');
    const agentCount = parseInt(result.rows[0].count);

    if (agentCount === 0) {
      console.log('Seeding default agents...');

      for (const agent of DEFAULT_AGENTS) {
        await query(
          `INSERT INTO agents (name, type, model_id, personality, capabilities)
           VALUES ($1, $2, $3, $4, $5)`,
          [agent.name, agent.type, agent.modelId, agent.personality, agent.capabilities]
        );
        console.log(`  Created agent: ${agent.name} (${agent.type})`);
      }

      console.log(`Seeded ${DEFAULT_AGENTS.length} agents`);
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
