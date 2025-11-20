// Setup file that runs before all tests
import { config } from 'dotenv';

// Load environment variables from .env
config();

// Log if API key is available (for debugging)
console.log('Test setup: API key', process.env.OPENAI_API_KEY ? 'loaded ✓' : 'missing ✗');
