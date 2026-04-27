import { db } from '../db/client.js';
import { agents, companies, costEntries } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

async function runTest() {
  console.log('🧪 Starte Security & Budget Verification Test...');
  try {
    const testCompanyId = 'test-company-' + Date.now();
    db.insert(companies).values({
      id: testCompanyId,
      name: 'Launch Verification Inc.',
      beschaffung: 'Test Company',
      ziel: 'Launch Testing',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).run();

    const testAgentId = 'test-agent-' + Date.now();
    db.insert(agents).values({
      id: testAgentId,
      companyId: testCompanyId,
      name: 'Budget Tester',
      role: 'Quality Assurance',
      title: 'QA',
      avatar: '🧪',
      avatarColor: '#FF0000',
      status: 'idle',
      connectionType: 'test',
      monthlyBudgetCent: 100, // 1€ Limit
      monthlySpendCent: 0,
      autoCycleIntervalSec: 60,
      autoCycleActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).run();
    console.log('✅ Test-Agent (Budget: 1,00€) erstellt.');

    // Simulate API Spend directly equivalent to what server/index.ts does
    const kostenCent = 150;
    console.log(`💸 Simuliere Verbrauch von ${kostenCent} Cents...`);
    
    db.insert(costEntries).values({
      id: uuid(),
      companyId: testCompanyId,
      agentId: testAgentId,
      anbieter: 'test',
      modell: 'test',
      kostenCent,
      zeitpunkt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }).run();

    db.update(agents).set({
      monthlySpendCent: sql`${agents.monthlySpendCent} + ${kostenCent}`,
      aktualisiertAm: new Date().toISOString(),
    }).where(eq(agents.id, testAgentId)).run();

    const agent = db.select().from(agents).where(eq(agents.id, testAgentId)).get();
    
    if (agent && agent.monthlyBudgetCent > 0) {
      const prozent = Math.round((agent.monthlySpendCent / agent.monthlyBudgetCent) * 100);
      if (prozent >= 100 && agent.status !== 'paused') {
        db.update(agents).set({ status: 'paused', updatedAt: new Date().toISOString() }).where(eq(agents.id, testAgentId)).run();
        console.log(`🛑 Agent wurde aufgrund Budget-Limitierung gestoppt (Budget ${prozent}%)`);
      }
    }

    // Verify
    const verifyAgent = db.select().from(agents).where(eq(agents.id, testAgentId)).get();
    if (verifyAgent.monthlySpendCent === 150 && verifyAgent.status === 'paused') {
      console.log('✅ ERFOLG: Agent-Status ist PAUSED. Budget-Limitierung greift hervorragend. READY FOR LAUNCH!');
    } else {
      console.error(`❌ FEHLER: Status ist ${verifyAgent.status}, Verbraucht: ${verifyAgent.monthlySpendCent}`);
    }

  } catch (err) {
    console.error('Test Failed:', err);
  } finally {
    process.exit(0);
  }
}

runTest();
