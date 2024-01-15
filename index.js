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
 *
 * Avoid leaving a cell empty if possible.
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
    log.debug( `----`, JSON.stringify( court.faxes, null, 2 ));
  }

  await browser.close();
};

async function collect_court({ url }) {
  log.debug(`collect_court() at \x1b[94m${url}\x1b[0m`);

  let court = {};
  court.url = url;
  await page.goto(url, { waitUntil: `domcontentloaded` });
  court.name = await get_name();
  court.description = await get_description();
  court.hours = await get_hours();
  court.physical_address = await get_physical_address();
  court.ada_coordinators = await get_adas();
  court.phones = await get_phones();
  court.faxes = await get_faxes();

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

async function get_notes() {
  log.debug(`get_adas()`);

  // Start with the outer parent of the address
  // Get all the children
  // Exclude the actual address and the link to the google directions

  // .ma__contact-group__address parent with .ma__contact-group__item
  // all children
  // exclude .ma__contact-group__address and .ma__contact-group__directions
  // concat contents

  // Maybe any text content that includes "note"? Or "please" (might over-collect)?

  // let text = await get_text({
  //   selector: `#accessibility + * strong`,
  //   throw_on_error: false,
  //   multi: true,
  // });
  // if ( !text ) { text = `No names detected`; }
  // return text;
};

async function get_adas() {
  log.debug(`get_adas()`);
  let text = await get_text({
    selector: `#accessibility + * strong`,
    throw_on_error: false,
    multi: true,
  });
  if ( !text ) { text = `None detected`; }
  return text;
};

async function get_phones() {
  /** Collect names and labels for every phone number.
   *
   * Flag possible clerk's numbers, though it will keep its label.
   * WARNING: there may be multiple numbers flagged as the clerk number.
   *
   * returns { number: str, label: str, is_clerk_number: bool }
   * */
  log.debug(`get_phones()`);

  let handles = await page.$$( `.ma__contact-group .ma__content-link[href*="tel:"]` );
  return await get_number_data({ handles });
}

async function get_faxes() {
  log.debug(`get_faxes()`);
  // cheat sheet: https://devhints.io/xpath#class-check
  // text: https://stackoverflow.com/a/6443078
  let x_selector = `//h2[contains(concat(' ',normalize-space(@class),' '),' ma__contact-group__name ')]`
    + `[contains(., 'Fax')]/..`
    + `//*[contains(concat(' ',normalize-space(@class),' '),' ma__contact-group__value ')]`;
  let handles = await page.$x( x_selector );

  // Take care of empty results later
  return await get_number_data({ handles });
};

async function get_number_data({ handles }) {
  log.debug(`get_number_data()`);

  let numbers_data = [];
  for ( let handle of handles ) {
    let one_data = await handle.evaluate(( elem ) => {
      // Get the number. I have seen invisible text (for screen readers probably).
      // Remove those nodes that are invisible and just get the visible text.
      let text_parts = Array.from( elem.childNodes ).reduce(function(text_list, node){
        if ( node.nodeType == Node.TEXT_NODE ) {
          text_list.push(node.textContent);
        } else if ( !node.className.split(/\s+/).includes('visually-hidden') ) {
          text_list.push(node.textContent);
        }
        return text_list;
      }, []);

      let number = { number: text_parts.join(` `).trim() };

      let sibling = elem.previousElementSibling;
      if ( sibling ) {
        number.label = sibling.textContent.trim();
      }

      // See https://www.mass.gov/locations/barnstable-district-court where
      // main number is not labeled, but there are 6 additional #'s
      // elsewhere on the page

      // if there's no sibling or sibling text is empty
      if ( !sibling || !number.label ) {
        // if there are no other numbers in the parent container
        let contact_container = elem.closest( `.ma__contact-group` );
        let children_that_are_numbers = contact_container.querySelectorAll( `.ma__content-link[href*="tel:"]` );
        // then we call it the primary number
        if ( children_that_are_numbers.length === 1 ) {
          number.label = "Assumed primary number";
        } else {
          // otherwise we don't know what it is
          number.label = "No label found";
        }
      }

      // if it's still undefined or an empty string
      if ( !number.label ) {
        number.label = "No label found";
      }
      // If the label includes 'clerk' in it, flag it as possibly the clerk's number
      // We are allowed to have multiple clerk numbers
      if ( number.label.toLowerCase().includes(`clerk`) ) {
        number.is_clerk_number = true;
      } else {
        number.is_clerk_number = false;
      }

      return number;
    });

    numbers_data.push( one_data );
  }

  return numbers_data;
};



// ===============================
// =========== generic ===========
async function get_text ({ selector, throw_on_error=false, multi=false }) {
  log.debug(`get_text()`);

  try {
    if ( multi ) {
      return await get_text_multi({ selector });
    } else {
      let handle = await page.$( selector );
      return await get_text_one({ handle });
    }
  // TODO: Catch further up? Each place might want a different return value.
  } catch (error) {
    if ( throw_on_error ) {
      throw error;
    } else {
      log.debug(`Error getting text:`, error);
      return false;
    }
  }  // ends try to get text
};

async function get_text_one ({ handle }) {
  // TODO: Rewrite to use xpath
  log.debug(`get_text_one()`);
  let text = await handle.evaluate(el => el.textContent);
  return text.trim();
};

async function get_text_multi ({ selector }) {
  // TODO: rewrite to use xpath
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
