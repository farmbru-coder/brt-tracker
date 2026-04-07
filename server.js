const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

const delay = (ms) => new Promise(r => setTimeout(r, ms));

app.get('/', (req, res) => {
  res.json({ status: 'BRT Tracker ready', version: '1.1' });
});

app.post('/track', async (req, res) => {
  const { tracking, zip } = req.body;
  if (!tracking || !zip) {
    return res.status(400).json({ error: 'tracking and zip are required' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1280,900']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'it-IT,it;q=0.9' });

    console.log(`[TRACK] Start: ${tracking} / ${zip}`);

    // Step 1: Go to BRT tracking
    // FIX: usa domcontentloaded invece di networkidle2
    // networkidle2 causa timeout perché BRT ha connessioni persistenti (Cookiebot, analytics)
    await page.goto('https://services.brt.it/it/tracking', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await delay(3000); // aspetta che JS carichi il form

    // Dismiss cookie banner
    try {
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('button, a')) {
          const t = b.textContent.toLowerCase().trim();
          if (t.includes('rifiuta') || t.includes('reject') || t === 'accetta selezionati') {
            b.click(); return;
          }
        }
      });
      await delay(1000);
    } catch (e) {}

    // Step 2: Enter tracking
    await page.waitForSelector('input[type="text"]', { timeout: 15000 });
    const input = (await page.$$('input[type="text"]'))[0];
    await input.click();
    await delay(300);
    await input.type(tracking, { delay: 80 });
    await delay(500);

    // Step 3: Click Cerca
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.trim().toLowerCase() === 'cerca') { b.click(); return; }
      }
    });

    // Step 4: Wait for navigation after Cerca
    // FIX: domcontentloaded invece di networkidle2
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {}
    await delay(3000);

    if (page.url().includes('services.brt.it')) await delay(3000);
    console.log(`[TRACK] URL after Cerca: ${page.url()}`);

    // Step 5: Enter CAP
    try {
      await page.waitForSelector('#verificationCode', { timeout: 15000 });
      const cap = await page.$('#verificationCode');
      if (cap) {
        await cap.click();
        await delay(300);
        await cap.type(zip, { delay: 80 });
        await delay(3000); // reCAPTCHA auto-resolve time

        // Step 6: Click Conferma
        await page.evaluate(() => {
          for (const s of document.querySelectorAll('input[type="submit"]')) {
            if (s.value?.toLowerCase().includes('conferma')) { s.click(); return; }
          }
        });

        // FIX: domcontentloaded invece di networkidle2
        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {}
        await delay(3000);
        console.log(`[TRACK] URL after Conferma: ${page.url()}`);
      }
    } catch (e) {
      console.log('[TRACK] No CAP field: ' + e.message);
    }

    // Step 7: Extract data
    const result = await page.evaluate(() => {
      const d = {
        hasFullDetails: false, status: 'unknown',
        pickupPointName: '', pickupPointAddress: '',
        brtCode: '', events: [], pageType: ''
      };

      d.hasFullDetails = !!document.querySelector('.content-item-track');
      d.pageType = d.hasFullDetails ? 'FULL_DETAILS'
        : (document.querySelector('#verificationCode') ? 'DATA_PROTECTION' : 'OTHER');

      const um = window.location.href.match(/parcelNumber=(\d{14})/);
      if (um) d.brtCode = um[1];

      const ds = document.querySelector('.deliveryDetails');
      if (ds) {
        const lbl = ds.querySelector('.block-data-label');
        if (lbl) d.pickupPointName = lbl.textContent.trim();
        for (const div of ds.querySelectorAll('.block-data-content > div')) {
          if (div.querySelector('.delivery-address-icon.location')) {
            for (const p of div.querySelectorAll('p')) {
              if (!p.classList.contains('delivery-address-icon') && p.textContent.trim()) {
                d.pickupPointAddress = p.textContent.trim(); break;
              }
            }
          }
        }
      }

      document.querySelectorAll('.content-item-track').forEach(item => {
        const txt = (item.querySelector('.tracking-details-alert') || item.querySelector('.entry-body p'))?.textContent?.trim() || '';
        if (txt) d.events.push({
          date:  item.querySelector('.entry-date')?.textContent?.trim()  || '',
          time:  item.querySelector('.entry-time')?.textContent?.trim()  || '',
          place: item.querySelector('.place-track span')?.textContent?.trim() || '',
          text:  txt
        });
      });

      const at = d.events.map(e => e.text.toLowerCase()).join(' ');
      if      (at.includes('punto di ritiro') || at.includes('fermopoint'))           d.status = 'pickup';
      else if (at.includes('consegna effettuata') || at.includes('consegnata con successo')) d.status = 'delivered';
      else if (at.includes('in consegna') || at.includes('in viaggio'))               d.status = 'transit';
      else if (at.includes('consegna non andata a buon fine'))                         d.status = 'delivery_failed';

      return d;
    });

    console.log(`[TRACK] Done: ${result.status} | point="${result.pickupPointName}" | ${result.events.length} events`);
    await browser.close();
    res.json(result);

  } catch (error) {
    console.error(`[TRACK] Error: ${error.message}`);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BRT Tracker on port ${PORT}`));
      document.querySelectorAll('.content-item-track').forEach(item => {
        const txt = (item.querySelector('.tracking-details-alert') || item.querySelector('.entry-body p'))?.textContent?.trim() || '';
        if (txt) d.events.push({
          date: item.querySelector('.entry-date')?.textContent?.trim() || '',
          time: item.querySelector('.entry-time')?.textContent?.trim() || '',
          place: item.querySelector('.place-track span')?.textContent?.trim() || '',
          text: txt
        });
      });

      const at = d.events.map(e => e.text.toLowerCase()).join(' ');
      if (at.includes('punto di ritiro') || at.includes('fermopoint')) d.status = 'pickup';
      else if (at.includes('consegna effettuata') || at.includes('consegnata con successo')) d.status = 'delivered';
      else if (at.includes('in consegna') || at.includes('in viaggio')) d.status = 'transit';
      else if (at.includes('consegna non andata a buon fine')) d.status = 'delivery_failed';

      return d;
    });

    console.log(`[TRACK] Done: ${result.status} | point="${result.pickupPointName}" | ${result.events.length} events`);
    await browser.close();
    res.json(result);

  } catch (error) {
    console.error(`[TRACK] Error: ${error.message}`);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BRT Tracker on port ${PORT}`));
