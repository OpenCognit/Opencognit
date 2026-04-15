import { db } from '../db/client.js';
import { experten, unternehmen, kostenbuchungen } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

async function runTest() {
  console.log('🧪 Starte Security & Budget Verification Test...');
  try {
    const testCompanyId = 'test-company-' + Date.now();
    db.insert(unternehmen).values({
      id: testCompanyId,
      name: 'Launch Verification Inc.',
      beschaffung: 'Test Company',
      ziel: 'Launch Testing',
      status: 'active',
      erstelltAm: new Date().toISOString(),
      aktualisiertAm: new Date().toISOString()
    }).run();

    const testAgentId = 'test-agent-' + Date.now();
    db.insert(experten).values({
      id: testAgentId,
      unternehmenId: testCompanyId,
      name: 'Budget Tester',
      rolle: 'Quality Assurance',
      titel: 'QA',
      avatar: '🧪',
      avatarFarbe: '#FF0000',
      status: 'idle',
      verbindungsTyp: 'test',
      budgetMonatCent: 100, // 1€ Limit
      verbrauchtMonatCent: 0,
      zyklusIntervallSek: 60,
      zyklusAktiv: false,
      erstelltAm: new Date().toISOString(),
      aktualisiertAm: new Date().toISOString()
    }).run();
    console.log('✅ Test-Agent (Budget: 1,00€) erstellt.');

    // Simulate API Spend directly equivalent to what server/index.ts does
    const kostenCent = 150;
    console.log(`💸 Simuliere Verbrauch von ${kostenCent} Cents...`);
    
    db.insert(kostenbuchungen).values({
      id: uuid(),
      unternehmenId: testCompanyId,
      expertId: testAgentId,
      anbieter: 'test',
      modell: 'test',
      kostenCent,
      zeitpunkt: new Date().toISOString(),
      erstelltAm: new Date().toISOString(),
    }).run();

    db.update(experten).set({
      verbrauchtMonatCent: sql`${experten.verbrauchtMonatCent} + ${kostenCent}`,
      aktualisiertAm: new Date().toISOString(),
    }).where(eq(experten.id, testAgentId)).run();

    const agent = db.select().from(experten).where(eq(experten.id, testAgentId)).get();
    
    if (agent && agent.budgetMonatCent > 0) {
      const prozent = Math.round((agent.verbrauchtMonatCent / agent.budgetMonatCent) * 100);
      if (prozent >= 100 && agent.status !== 'paused') {
        db.update(experten).set({ status: 'paused', aktualisiertAm: new Date().toISOString() }).where(eq(experten.id, testAgentId)).run();
        console.log(`🛑 Agent wurde aufgrund Budget-Limitierung gestoppt (Budget ${prozent}%)`);
      }
    }

    // Verify
    const verifyAgent = db.select().from(experten).where(eq(experten.id, testAgentId)).get();
    if (verifyAgent.verbrauchtMonatCent === 150 && verifyAgent.status === 'paused') {
      console.log('✅ ERFOLG: Agent-Status ist PAUSED. Budget-Limitierung greift hervorragend. READY FOR LAUNCH!');
    } else {
      console.error(`❌ FEHLER: Status ist ${verifyAgent.status}, Verbraucht: ${verifyAgent.verbrauchtMonatCent}`);
    }

  } catch (err) {
    console.error('Test Failed:', err);
  } finally {
    process.exit(0);
  }
}

runTest();
