const puppeteer = require(`puppeteer`);
const fs = require(`fs`);

/** Resources
 * https://github.com/GBLS/docassemble-MACourts/issues/61
 * https://github.com/plocket/ma_court_contact_info_scraper/discussions/2
 * */

/** Data shape
 *
 * [{
 *   url: str,
 *   name: str,
 *   description: str,
 *   hours: str,
 *   ada_coordinators: [str],
 *
 *   physical_address: str,
 *   mailing_address: str,
 *   phone_1_number: str,
 *   phone_1_label: str,
 *   phone_2_number: str,
 *   phone_2_label: str,
 *   phone_n_number: str,
 *   phone_n_label: str,
 *   fax: str,
 *   notes: str,
 * }]
 * */

let debug = true;

// const URLS = JSON.parse(fs.readFileSync(`./urls.json`));
const URLS = JSON.parse(fs.readFileSync(`./test_urls.json`));
let state = JSON.parse(fs.readFileSync(`./state.json`));
let page = null;

let warnings = [];

async function start() {
  log.debug(`start()`);

  try {
    await collect_all({ urls: URLS });
  } catch (error) {
    `red \x1b[31m reset \x1b[0m`
    console.log(`\x1b[31mERROR at ${new Date().toLocaleString()}\x1b[0m`);
    try {
      // `page` might not exist
      await page.screenshot({ path: `__page_error.jpg` });
      // const body = await page.$eval(`body`, (elem)=>{ return elem.outerHTML });
      // console.log(body);
    } catch (error) { `do nothing`; }

    if ( warnings.length > 0 ) {
        console.log(`Also there were warnings:`);
        for ( let warning of warnings ) {
          console.log( `- ${ warning }`);
        }
    }
    throw error;
  }

  if ( warnings.length > 0 ) {
    `red \x1b[31m reset \x1b[0m`
    console.log(`\x1b[31mWARNING(S) at ${new Date().toLocaleString()}.\x1b[0m`);
    for ( let warning of warnings ) {
      console.log( `- ${ warning }`);
    }
  } else {
    console.log(`✔ Ended at ${new Date().toLocaleString()}`);
  }
};

async function collect_all({ urls }) {
  log.debug(`collect_all()`);

  const browser = await puppeteer.launch({
    // // Have to interact with the browser prompt manually
    // headless: !debug,
    // devtools: debug,
  });
  page = await browser.newPage();

  console.log(`Starting with \x1b[94m${ urls[0] }\x1b[0m. ${ URLS.length - state.collection_index } courts remaining`);
  console.log(`Current date and time: ${new Date().toLocaleString()}`);
  
  let remaining_urls = URLS.slice(state.collection_index);

  for ( let url of remaining_urls ) {
    let court = await collect_court({ url });
    log.debug( JSON.stringify( court.ada_coordinators ));
  }

  await browser.close();
};

async function collect_court({ url }) {
  log.debug(`collect_court() at ${url}`);

  let court = {};
  court.url = url;
  await page.goto(url, { waitUntil: `domcontentloaded` });
  court.name = await get_name();
  court.description = await get_description();
  court.hours = await get_hours();
  court.physical_address = await get_physical_address();
  court.ada_coordinators = await get_adas();

  return court;
};

async function get_name() {
  log.debug(`get_name()`);
  return await get_text({
    selector: `h1.ma__page-header__title`,
    throw_on_error: true,
    multi: false,
  });
};

async function get_description() {
  log.debug(`get_description()`);
  return await get_text({
    selector: `#overview + *`,
    throw_on_error: true,
    multi: false,
  });
};

async function get_hours() {
  log.debug(`get_hours()`);
  let raw = await get_text({
    selector: `#hours + *`,
    throw_on_error: true,
    multi: false,
  });
  let clean = raw.replace(/\n/g, ``).replace(/\s+/g, ` `);
  return clean
};

async function get_physical_address() {
  log.debug(`get_physical_address()`);
  return await get_text({
    selector: `.ma__contact-group__address`,
    // Does every site include the address in the right place?
    throw_on_error: true,
    multi: false,
  });
};

async function get_adas() {
  log.debug(`get_adas()`);
  let text = await get_text({
    selector: `#accessibility + * strong`,
    throw_on_error: false,
    multi: true,
  });
  if ( !text ) { text = `No names detected`; }
  return text;
};

// async function get_phones() {
//   log.debug(`get_phones()`);



//   let text = await get_text({
//     selector: `#accessibility + * strong`,
//     throw_on_error: false,
//     multi: true,
//   });
//   if ( !text ) { text = `No names detected`; }
//   return text;
// };



// ===============================
// =========== generic ===========
async function get_text ({ selector, throw_on_error=false, multi=false }) {
  log.debug(`get_text()`);

  try {
    if ( multi ) {
      return await get_text_multi({ selector });
    } else {
      return await get_text_one({ selector });
    }
  } catch (error) {
    if ( throw_on_error ) {
      throw error;
    } else {
      log.debug(`Error getting text:`, error);
      return false;
    }
  }  // ends try to get text
};

async function get_text_one ({ selector }) {
  log.debug(`get_text_one()`);
  let handle = await page.$(selector);
  let text = await handle.evaluate(el => el.textContent);
  return text.trim();
};

async function get_text_multi ({ selector }) {
  log.debug(`get_text_multi()`);
  const combined_text = await page.evaluate((selector) => {
    let elements = Array.from(document.querySelectorAll(selector));
    return elements.map(element => element.textContent).join(`, `);
  }, selector);
  return combined_text.trim();
};

// ============================
// =========== data ===========
function get_stored_courts_data () {
  ensure_dir_exists({ dir_path: `data` });
  return get_value_safely({ file_path: `data/courts.json`, default_value: [] });
}

function save_court_data ({ index, one_court }) {
  let data = get_value_safely({ file_path: `data/courts.json`, default_value: [] });
  data[ index ] = one_court;
  write_file_safely ({
    file_path: `data/courts.json`,
    contents: JSON.stringify( data, null, 2 )
  })
}

function ensure_dir_exists ({ dir_path }) {
  log.debug(`ensure_dir_exists()`);
  try {
    can_access_path_correctly({ path: dir_path });
  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.debug(`Creating ${ dir_path }`);
      fs.mkdirSync( dir_path, { recursive: true });
      log.debug(`Created ${ dir_path }`);
    } else {
       throw( error )
    }

  }  // ends try
}

function get_value_safely ({ file_path, default_value }) {
  log.debug(`get_value_safely()`);
  try {
    return JSON.parse( fs.readFileSync( file_path ));
  } catch ( error ) {
    // We don't care about files that don't exist
    if ( error.code !== `ENOENT` ) {
      log.debug(`JSON parse messages file error:`, error);
    }
    return default_value;
  }
}

function write_file_safely ({ file_path, contents }) {
  log.debug(`write_file_safely()`);
  try {
    can_access_path_correctly({ path: file_path });
    fs.writeFileSync(file_path, contents);
  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.debug(`Creating ${ file_path }`);
      fs.writeFileSync(file_path, contents);
      log.debug(`Created ${ file_path }`);
    } else {
       throw( error );
    }

  }  // ends try
}

function can_access_path_correctly ({ path }) {
  try {

    log.debug(`can_access_path_correctly()`);
    fs.accessSync( path );
    log.debug(`The ${ path } path exists`);
    fs.accessSync( path, fs.constants.W_OK );
    log.debug(`You can write to ${ path }`);
    return true;

  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.debug(`${ path } is missing`);
    } else if ( error.code === `EACCES` ) {
      log.debug(`You have no write permissions for ${ path }`);
    }
    throw( error );

  }  // ends try
}


// ============================
// =========== logs ===========
const log = {
  debug: function () {
    if ( debug ) {
      console.log( `Debug:`, ...arguments );
    }
  },
  print_inline: function ({ message }) {
    process.stdout.write(`\x1b[36m${ message }\x1b[0m`);
  }
}




start();
