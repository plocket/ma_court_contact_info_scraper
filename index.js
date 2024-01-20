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
let debug_log = false;
let run_id = Date.now();

const URLS = JSON.parse(fs.readFileSync(`./urls.json`));
// const URLS = JSON.parse(fs.readFileSync(`./test_urls.json`));
let state = JSON.parse(fs.readFileSync(`./state.json`));
let page = null;

let warnings = [];

async function start() {
  log.debug(`start()`);

  try {
    await collect_all({ urls: URLS });
  } catch (error) {
    `red \x1b[31m reset \x1b[0m`
    log.debug(`\x1b[31mERROR at ${new Date().toLocaleString()}\x1b[0m`);
    try {
      // `page` might not exist
      await page.screenshot({ path: `__page_error.jpg` });
      // const body = await page.$eval(`body`, (elem)=>{ return elem.outerHTML });
      // log.debug(body);
    } catch (error) { `do nothing`; }

    if ( warnings.length > 0 ) {
        log.debug(`Also there were warnings:`);
        for ( let warning of warnings ) {
          log.debug( `- ${ warning }`);
        }
    }
    throw error;
  }

  if ( warnings.length > 0 ) {
    `red \x1b[31m reset \x1b[0m`
    log.debug(`\x1b[31mWARNING(S) at ${new Date().toLocaleString()}.\x1b[0m`);
    for ( let warning of warnings ) {
      log.debug( `- ${ warning }`);
    }
  } else {
    log.debug(`✔ Ended at ${new Date().toLocaleString()}`);
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
  `blue \x1b[94m reset \x1b[0m`
  log.debug(`Starting with \x1b[94m${ urls[ state.collection_index ] }\x1b[0m. ${ URLS.length - state.collection_index } courts remaining`);
  log.debug(`Current date and time: ${new Date().toLocaleString()}`);

  if ( state.collection_index === 0 ) {
    log.debug( `Starting court file` );
    start_court_file();
  }
  let remaining_urls = URLS.slice(state.collection_index);
  log.debug( `Number of remaining urls:`, remaining_urls.length);

  for ( let url of remaining_urls ) {
    log.debug( `Collecting`)
    let court = await collect_court({ url });
    log.debug( `----`, JSON.stringify( court, null, 2 ));
    save_court ({ court });
    state.collection_index += 1;
    save_state ({ state });
  }

  await browser.close();
};

async function collect_court({ url }) {
  `blue \x1b[94m reset \x1b[0m`;
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
  court.notes = await get_notes();

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
    // Does every site include the address in the right place as?
    throw_on_error: true,
    multi: false,
  });
};

async function get_notes() {
  log.debug(`get_notes()`);
  // Maybe any text content that includes "note"? Or "please" (might over-collect)?

  // Start with address
  let x_selector = `//*[contains(concat(' ',normalize-space(@class),' '),' ma__contact-group__address ')]`;
  // Get adress parent
  x_selector += `/ancestor::*[contains(concat(' ',normalize-space(@class),' '),' ma__contact-group__item ')]`;
  // Get all the direct children `span`s. I'm not sure this is sufficent.
  x_selector += `/span`;

  return await get_text({
    selector: x_selector,
    is_xpath: true,
    throw_on_error: false,
    multi: true,
  });
};

async function get_adas() {
  log.debug(`get_adas()`);
  return await get_text({
    selector: `#accessibility + * strong`,
    throw_on_error: false,
    multi: true,
  });
};

async function get_phones() {
  /** Collect names and labels for every phone number.
   *
   * Flag possible clerk's numbers, though it will keep its label.
   * WARNING: there may be multiple numbers flagged as the clerk number.
   *
   * returns { number: str, label: str, has_clerk: bool }
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

      let number = { number: JSON.stringify(text_parts.join(` `).trim()) };

      let sibling = elem.previousElementSibling;
      if ( sibling ) {
        number.label = JSON.stringify(sibling.textContent.trim());
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
          number.label = `None detected`;
        }
      }

      // if it's still undefined or an empty string
      if ( !number.label ) {
        number.label = `None detected`;
      }
      // If the label includes 'clerk' in it, flag it as possibly the clerk's number
      // We are allowed to have multiple clerk numbers
      if ( number.label.toLowerCase().includes(`clerk`) ) {
        number.has_clerk = true;
      } else {
        number.has_clerk = false;
      }

      return number;
    });

    numbers_data.push( one_data );
  }

  return numbers_data;
};



// ============================
// =========== text ===========
async function get_text ({ selector, is_xpath=false, throw_on_error=false, multi=false }) {
  log.debug(`get_text()`);

  try {
    let handles = null;
    if ( is_xpath ) { handles = await page.$x(selector); }
    else { handles = await page.$$( selector ); }

    if ( multi ) {
      return await get_text_multi({ handles });
    } else {
      if ( handles.length > 1 ) {
      `red \x1b[31m reset \x1b[0m`
        log.debug( `\x1b[31mWARNING\x1b[0m: Expected there to be 1 of "${ selector }", but there were \x1b[31m${ handles.length }\x1b[0m.` );
      }
      return await get_text_one({ handle: handles[0] });
    }

  } catch (error) {
    // TODO: Catch further up? Each place might want a different return value.
    if ( throw_on_error ) {
      throw error;
    } else {
      log.debug(`Error getting maybe non-existent text, but it's probably ok:\n`, error);
      return `None detected`;
    }
  }  // ends try to get text
};

async function get_text_multi ({ handles }) {
  log.debug(`get_text_multi()`);

  let text_parts = [];

  // TODO: look into `.$$eval()`
  for ( let handle of handles ) {
    let text = await get_text_one({ handle });
    // Remove final periods
    text_parts.push( text.replace(/\.$/, ``) );
  }

  if ( handles.length > 0 ) {
    // Add periods between parts and a period at the end
    // This probably won't be perfect.
    return JSON.stringify(text_parts.join(`. `) + `.`);
  } else {
    return `None detected`;
  }



  // const combined_text = await page.evaluate((selector) => {
  //   let elements = Array.from(document.querySelectorAll(selector));
  //   return elements.map(element => element.textContent).join(`, `);
  // }, selector);
  // return combined_text.trim();
};

async function get_text_one ({ handle }) {
  log.debug(`get_text_one()`);
  let text = await handle.evaluate(el => el.textContent);
  return JSON.stringify(text.trim());
};



// ============================
// =========== logs ===========
const log = {
  debug: function () {
    // Write to console on debug
    if ( debug ) {
      console.log( `Debug:`, ...arguments );
    }
    // Add to log file
    ensure_dir_exists({ dir_path: `__logs` });
    let path = `__logs/${ run_id }.txt`;
    let log_contents = get_text_safely({ file_path: path, default_value: `` });

    // let ansi_parts = `${ arguments.join(' ') }`.split(/\x1B/);
    // let html_parts = ansi_parts.map(( ansi ) => {
    //   let html = `<span style="`;
    //   html += `">`
    // });
    // let str = '';
    // let html = `<p>${ str }</p>`;
    // html = html_args.split(/\x1B/);

    // Add a new line at the end
    log_contents += `${ [...arguments].join(' ') }\n`;
    write_file_safely({ file_path: path, contents: log_contents });
  },

  non_writing_debug: function () {
    // Write to console when debugging logs
    if ( debug_log ) {
      console.log(`non_writing_debug()`);
      console.log( `Non-writing Debug:`, ...arguments );
    }
  },

  print_inline: function ({ message }) {
    console.log(`print_inline()`);
    `cyan \x1b[36m`; `reset \x1b[0m`
    process.stdout.write(`\x1b[36m${ message }\x1b[0m`);
  }
}


// ============================
// =========== data ===========
function save_state ({ state }) {
  log.debug(`save_state():`, state);
  let path = `state.json`;
  write_file_safely({ file_path: path, contents: JSON.stringify( state, null, 2 ) });
};

let courts_path = `courts.csv`;
let max_num_phones = 10;
let max_num_faxes = 5;
let headers = ``;
let headers_count = [];

function start_court_file () {
  headers = `name;url;description;physical_address;hours;`;
  headers_count.push(headers.split(`;`).length - 1);
  // log.debug(`Headers item count 1:`, headers.split(`;`).length);
  for ( let phone_i = 1; phone_i <= max_num_phones; phone_i++ ) {
    headers += `phone${ phone_i }_number;phone${ phone_i }_label;phone${ phone_i }_has_clerk;`;
  }
  // log.debug(`Headers item count 2:`, headers.split(`;`).length);
  headers_count.push(headers.split(`;`).length - 1);
  for ( let fax_i = 1; fax_i <= max_num_faxes; fax_i++ ) {
    headers += `fax${ fax_i }_number;fax${ fax_i }_label;fax${ fax_i }_has_clerk;`;
  }
  // log.debug(`Headers item count 3:`, headers.split(`;`).length);
  headers_count.push(headers.split(`;`).length - 1);
  headers += `ada_coordinators;notes;mailing_address`;
  log.debug(`Num headers:`, headers.split(`;`).length);
  headers_count.push(headers.split(`;`).length);


  write_file_safely({ file_path: courts_path, contents: headers });
};

function save_court ({ court }) {
  log.debug(`save_court()`);

  let str_for_missing = `N/A`;

  // let headers = `name;url;description;physical_address;hours;`;
  // for ( let phone_i = 1; phone_i <= max_num_phones; phone_i++ ) {
  //   headers += `phone${ phone_i }_number;phone${ phone_i }_label;phone${ phone_i }_has_clerk;`;
  // }
  // for ( let fax_i = 1; fax_i <= max_num_faxes; fax_i++ ) {
  //   headers += `fax${ fax_i }_number;fax${ fax_i }_label;fax${ fax_i }_has_clerk;`;
  // }
  // headers += `ada_coordinators;notes;mailing_address`;
  // log.debug(`num headers:`, headers.split(`;`).length);

  // let courts_path = `courts.csv`

  log.debug(`Num headers:`, headers_count );

  let csv = get_text_safely({
    file_path: courts_path,
    default_value: headers
  });

  let new_line = `${ court.name };${ court.url };${ court.description };`
    + `${ court.physical_address };${ court.hours };`;
  log.debug(`New line item count 1:`, new_line.split(`;`).length - 1);
  // for ( let phone of court.phones ) {
  //   new_line += `${ phone.number };${ phone.label };${ phone.has_clerk };`;
  //   log.debug(`${ phone.number };${ phone.label };${ phone.has_clerk };`);
  // }
  log.debug(`Num phones:`, court.phones.length);
  for ( let phone_i = 0; phone_i < max_num_phones; phone_i++ ) {
    let phone = court.phones[ phone_i ];
    if ( phone ) {
      new_line += `${ phone.number };${ phone.label };${ phone.has_clerk };`;
    } else {
      new_line += `${ str_for_missing };${ str_for_missing };false;`;
    }
  }
  log.debug(`New line item count 2:`, new_line.split(`;`).length - 1);
  // for ( let fax of court.faxes ) {
  //   new_line += `${ fax.number };${ fax.label };${ fax.has_clerk };`;
  //   log.debug(`${ fax.number };${ fax.label };${ fax.has_clerk };`);
  // }
  log.debug(`Num faxes:`, court.faxes.length);
  for ( let fax_i = 0; fax_i < max_num_faxes; fax_i++ ) {
    let fax = court.faxes[ fax_i ];
    log.debug(`faxes[${fax_i}]: ${JSON.stringify(fax)}`)
    if ( fax ) {
      new_line += `${ fax.number };${ fax.label };${ fax.has_clerk };`;
    } else {
      new_line += `${ str_for_missing };${ str_for_missing };false;`;
    }
  }
  log.debug(`New line item count 3:`, new_line.split(`;`).length - 1);
  new_line += `${ court.ada_coordinators };${ court.notes };Not yet handled`;
  log.debug(`Num row items:`, new_line.split(`;`).length);

  csv += `\n${ new_line }`;

  write_file_safely({ file_path: courts_path, contents: csv });
};

function ensure_dir_exists ({ dir_path }) {
  log.non_writing_debug(`ensure_dir_exists()`);
  try {
    can_access_path_correctly({ path: dir_path });
  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.non_writing_debug(`Creating ${ dir_path }`);
      fs.mkdirSync( dir_path, { recursive: true });
      log.non_writing_debug(`Created ${ dir_path }`);
    } else {
       throw( error )
    }

  }  // ends try
}

function get_json_value_safely ({ file_path, default_value }) {
  log.debug(`get_json_value_safely()`);
  try {
    return JSON.parse( get_text_safely({ file_path, default_value }) );
  } catch ( error ) {
    // We don't care about files that don't exist
    if ( error.code !== `ENOENT` ) {
      log.debug(`Error parsing JSON:`, error);
    }
    return default_value;
  }
}

function get_text_safely ({ file_path, default_value }) {
  log.non_writing_debug(`get_text_safely()`);
  try {
    return fs.readFileSync( file_path );
  } catch ( error ) {
    // We don't care about files that don't exist
    if ( error.code !== `ENOENT` ) {
      log.non_writing_debug(`Error reading file:`, error);
    }
    return default_value;
  }
}

function write_file_safely ({ file_path, contents }) {
  log.non_writing_debug(`write_file_safely()`);
  try {
    can_access_path_correctly({ path: file_path });
    fs.writeFileSync(file_path, contents);
  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.non_writing_debug(`Creating ${ file_path }`);
      fs.writeFileSync(file_path, contents);
      log.non_writing_debug(`Created ${ file_path }`);
    } else {
       throw( error );
    }

  }  // ends try
}

function can_access_path_correctly ({ path }) {
  try {

    log.non_writing_debug(`can_access_path_correctly()`);
    fs.accessSync( path );
    log.non_writing_debug(`The ${ path } path exists`);
    fs.accessSync( path, fs.constants.W_OK );
    log.non_writing_debug(`You can write to ${ path }`);
    return true;

  } catch ( error ) {

    if ( error.code === `ENOENT` ) {
      log.non_writing_debug(`${ path } is missing`);
    } else if ( error.code === `EACCES` ) {
      log.non_writing_debug(`You have no write permissions for ${ path }`);
    }
    throw( error );

  }  // ends try
}




start();
