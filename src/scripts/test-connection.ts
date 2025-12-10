import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function testConnection() {
  console.log('🔍 Testing database connection...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));
  
  try {
    // Test connection
    await prisma.$connect();
    console.log('✅ Connection successful!');
    
    // Test query
    const userCount = await prisma.user.count();
    console.log(`✅ Database query successful! Current users: ${userCount}`);
    
    // List tables
    const result = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;
    console.log(`✅ Found ${result.length} tables in database`);
    console.log('Tables:', result.map(r => r.tablename).slice(0, 5).join(', '), '...');
    
  } catch (error: any) {
    console.error('❌ Connection failed:', error.message);
    if (error.code === 'P1000') {
      console.error('   This is an authentication error. Check your DATABASE_URL in .env');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();


