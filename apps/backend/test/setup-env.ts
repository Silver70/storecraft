// Runs before every e2e test file, ahead of any application code being
// imported, so AppModule's ConfigModule reads the local test database.
import { loadTestEnv } from './helpers/test-env';

loadTestEnv();
