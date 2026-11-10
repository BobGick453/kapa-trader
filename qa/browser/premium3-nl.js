// Premium end to end with the real Kapa server: gift codes made in Admin, Premium on the Deriv account
// (survives reloads, ends when revoked), a CinetPay payment that switches Premium on by itself, scan, a
// KAPA Target session on the server, Premium bots, forged passes refused.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
const P = require('./premium-env');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const S = await P.setup({ cinetpay: true });
  const W = +(process.env.W || 400);
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: W, height: 860 } });
  const errs = []; pg.on('pageerror', (e) => { if (!/^Event$|_\.Dd|_\.zd/.test(e.message)) errs.push(e.message); });
  const stats = { buys: [] }; const st = await mock.install(pg, { handler: trade(stats) }); await S.attach(pg, st);
  await P.login(pg);
  await P.openS(pg); await pg.waitForSelector('#kapa-premium-code', { timeout: 10000 }).catch(() => {});
  ok(await pg.locator('#kapa-premium-code').isVisible(), 'Premium card asks for a gift code');
  ok(/Pay with CinetPay/.test(await pg.textContent('.kapa-premium')), 'CinetPay is offered when it is set up');
  // owner makes a gift code in Admin
  await P.closeS(pg); await pg.click('#id-admin'); await pg.waitForSelector('.kapa-admin__card--login input'); await pg.fill('.kapa-admin__card--login input', P.ADMIN); await pg.click('.kapa-admin__gold');
  await pg.waitForSelector('input[aria-label="Gift code name"]');
  await pg.fill('input[aria-label="Gift code name"]', 'Test friends'); await pg.fill('input[aria-label="How many uses"]', '2');
  await pg.click('.kapa-admin__card:has-text("Gift codes") .kapa-admin__gold'); await pg.waitForSelector('.kapa-admin__newcode b');
  const code = (await pg.textContent('.kapa-admin__newcode b')).trim();
  ok(/^KAPA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'owner makes a gift code in Admin: ' + code);
  ok(/Test friends/.test(await pg.textContent('.kapa-admin')) && /0 \/ 2/.test(await pg.textContent('.kapa-admin')), 'Admin lists it (0 / 2 uses)');
  await pg.screenshot({ path: `c-${W}-admin.png` });
  // a wrong code, then the gift code
  await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await P.dismiss(pg);
  await P.openS(pg); await pg.fill('#kapa-premium-code', 'KAPA-WRONG-CODE-1'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(800);
  ok(/Wrong code/.test(await pg.textContent('.kapa-premium')), 'a wrong code is refused');
  await pg.fill('#kapa-premium-code', code.toLowerCase()); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(1500);
  ok(/Premium is active on your Deriv account until/.test(await pg.textContent('.kapa-premium')), 'the gift code switches Premium on for the Deriv account, with its end date');
  ok(!/🔒/.test(await pg.textContent('.kapa-ring')), 'scanner unlocked');
  await pg.screenshot({ path: `c-${W}-unlocked.png` });
  await pg.reload(); await pg.waitForSelector('.kapa-card--main, .kapa-lock', { timeout: 20000 }); await pg.waitForTimeout(4000); await P.dismiss(pg);
  await P.openS(pg); ok(/Premium is active/.test(await pg.textContent('.kapa-premium')), 'Premium stays on after reloading the page (it belongs to the account)');
  // Premium tools: KAPA Target, scan, a session on the server
  await pg.selectOption('.kapa-field:has-text("Strategy") select', 'target'); await pg.fill('.kapa-field:has-text("Stop-loss") input', '30');
  await pg.click('.kapa-link:has-text("advanced")'); await pg.fill('.kapa-field:has-text("Pause between") input', '0');
  await P.closeS(pg); await pg.fill('.kapa-field:has-text("Take-profit") input', '2');
  await pg.click('.kapa-ring'); await pg.waitForSelector('.kapa-sig', { timeout: 20000 });
  ok((await pg.locator('.kapa-sig').count()) === 3, 'server scan works with Premium');
  await pg.locator('.kapa-use').first().click(); await pg.waitForSelector('.kapa-modal__title'); await pg.waitForTimeout(700); await pg.screenshot({ path: 'x/m-' + W + '-activate.png' });
  ok(/Load these settings/.test(await pg.textContent('.kapa-modal')), 'the activation window says it loads settings (it does not start trading)');
  await pg.click('.kapa-modal .kapa-btn--gold');
  const before = stats.buys.length; await pg.click('.kapa-runbtn');
  await pg.waitForSelector('.kapa-result', { timeout: 120000 }).catch(() => {}); await pg.waitForTimeout(1500); await pg.screenshot({ path: 'x/m-' + W + '-result.png' });
  ok(stats.buys.length > before && S.calls.some((c) => c.path === '/session/next' && c.status === 200), `KAPA Target runs on the server (${stats.buys.length - before} trades)`);
  await pg.click('.kapa-btn--lime').catch(() => {});
  // Free Bot → "Apex recovery" (Premium): KAPA AI opens with the bot and the option on
  await P.closeS(pg); await pg.click('#id-free-bot'); await pg.waitForSelector('.free-bot__card');
  await pg.click('.free-bot__card[data-bot="dollar_printer"] .free-bot__btn--apex'); await pg.waitForTimeout(1500);
  ok(/with KAPA Apex recovery loaded from Free Bot/.test(await pg.textContent('.kapa-scanmsg')), 'Free Bot "Apex recovery" opens KAPA AI with the bot and the Premium option');
  await P.openS(pg); ok(await pg.locator('.kapa-check input').isChecked(), 'the KAPA Apex recovery option is on (Premium active)'); await P.closeS(pg);
  // a buyer pays: Premium switches on by itself for the buyer's Deriv account
  const buyer = await b.newPage({ viewport: { width: W, height: 860 } });
  const bStats = { buys: [] }; const st2 = await mock.install(buyer, { handler: trade(bStats) }); await S.attach(buyer, st2, ['CR4242']);
  await P.login(buyer);
  await P.openS(buyer); ok(await buyer.locator('#kapa-premium-code').isVisible(), 'another person (new account) sees Premium locked');
  await buyer.click('.kapa-premium__buy .kapa-btn:has-text("CinetPay")'); await buyer.waitForURL(/checkout\.cinetpay\.com/, { timeout: 10000 }); await buyer.click('#pay');
  await buyer.waitForURL(/localhost:8770\/kapa-trader/, { timeout: 15000 }); await buyer.waitForTimeout(3000); await P.dismiss(buyer);
  await P.openS(buyer); await buyer.waitForFunction(() => /Payment confirmed/.test(document.querySelector('.kapa-premium')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
  const bt = await buyer.textContent('.kapa-premium');
  ok(/Payment confirmed: KAPA AI Premium is active on your Deriv account until .*kapa_[a-z0-9]+_[a-f0-9]{10}/.test(bt), 'after paying, Premium is on at once (with the payment reference): ' + bt.replace(/\s+/g, ' ').slice(0, 120));
  ok(/Premium is active on your Deriv account/.test(bt) && !(await buyer.locator('#kapa-premium-code').isVisible()), 'no code needed after a payment');
  await buyer.screenshot({ path: `c-${W}-buyer-paid.png` });
  // the owner sees the payment and the account in Admin, and ends the buyer's Premium
  await P.closeS(pg); await pg.click('#id-admin'); await pg.waitForSelector('.kapa-admin__table');
  await pg.waitForFunction(() => /CR4242/.test(document.querySelector('.kapa-admin')?.textContent || '') && /kapa_[a-z0-9]+_[a-f0-9]{10}/.test(document.querySelector('.kapa-admin')?.textContent || ''), null, { timeout: 15000 }).catch(() => {}); // the lists load after the page opens
  const adminText = await pg.textContent('.kapa-admin');
  ok(/kapa_[a-z0-9]+_[a-f0-9]{10}/.test(adminText) && /paid/.test(adminText) && /CR4242/.test(adminText), 'owner sees the paid payment and the buyer\'s Premium account in Admin');
  pg.once('dialog', (d) => d.accept()); await pg.locator('tr:has-text("CR4242") button:has-text("End now")').click(); await pg.waitForTimeout(1000);
  ok(/Premium ended for CR4242/.test(await pg.textContent('.kapa-admin')), 'owner ends a Premium from Admin');
  await new Promise((x) => setTimeout(x, 200));
  await buyer.reload(); await buyer.waitForSelector('.kapa-card--main, .kapa-lock', { timeout: 20000 }); await buyer.waitForTimeout(4000); await P.dismiss(buyer);
  await P.openS(buyer); ok(/PREMIUM ENDED/.test(await buyer.textContent('.kapa-premium')), 'the buyer sees Premium ended');
  // without Premium, the Free Bot "Apex recovery" button loads the bot but Start asks for Premium
  await P.closeS(buyer); await buyer.click('#id-free-bot'); await buyer.waitForSelector('.free-bot__card');
  await buyer.click('.free-bot__card[data-bot="profit_maker"] .free-bot__btn--apex'); await buyer.waitForTimeout(1500); await P.closeS(buyer);
  await buyer.click('.kapa-runbtn'); await buyer.waitForTimeout(800);
  ok(/KAPA Apex recovery is part of KAPA AI Premium/.test(await buyer.textContent('.kapa-error').catch(() => '')) && bStats.buys.length === 0, 'without Premium, Start with Apex recovery asks for Premium and trades nothing');
  // a pass forged in the page is useless
  const hack = await buyer.evaluate(async () => { localStorage.setItem('kapa_premium_pass', 'eyJ2IjoxLCJ0eXAiOiJwYXNzIiwidmVyIjoieCIsImV4cCI6OTk5OTk5OTk5OTk5OX0.AAAA'); const r = await fetch('https://kapa-premium.netlify.app/bots/odd-oscars', { headers: { 'x-kapa-pass': localStorage.getItem('kapa_premium_pass') } }); return r.status; });
  ok(hack === 401 || hack === 402, 'a forged pass written into the page is refused (' + hack + ')');
  console.log('page errors:', errs.slice(0, 5)); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
