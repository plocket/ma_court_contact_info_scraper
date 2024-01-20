# ma_court_contact_info_scraper

Rudimentary scraping of MA court websites for their contact details and instructions.

Created for https://github.com/GBLS/docassemble-MACourts/issues/61.

## Set up

Having experience with node and npm will help a lot. You must have [`node` and `npm` installed](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) on the computer you're using.

1. Clone the repo
2. Run

```
npm install
```

## Run

3. Make sure `state.json`'s `collection_index` is set to `0`.
4. Run

```
npm run start
```

## Troubleshoot

- There are logs in the console during the run.
- A new file in `__logs` will be added with every run and will contain the same logs as appeared in the console. Git ignores that folder.
- If possible, the script takes a screenshot of the problem page if it can. Git ignores that file.
- In `index.js`, you can:
   - Disable headless mode so you can see the script running in a browswer.
   - Enable the dev tools in that browser to see if there are any errors logged there.
   - Enable `slowMo` for puppeteer to give your human brain time to see what's going on.
To do those, search for "puppeteer.launch" in `index.js`.
