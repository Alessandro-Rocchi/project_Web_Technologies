/**
 * =============================================================================
 * SCRIPTS.JS - Multi-Page Controller & Interactive Tour Engine
 * =============================================================================
 * This script provides core application logic across multiple pages:
 * - Guided Tour Engine (tour.html): URL parameter routing, director-filtered
 *   GeoJSON map rendering, smooth camera fly-to animations, narrative stop-by-stop
 *   presentation, progress tracking, and tour navigation controls.
 * - Catalogue Controller (catalogue.html): Location card grid rendering, responsive
 *   desktop filter sidebar toggling, dynamic smart pagination with ellipses,
 *   and automatic scroll-to-top on page transitions.
 * - Global Theme Switcher: Dynamic CSS stylesheet swapping with persistence
 *   in browser localStorage across all site pages.
 * =============================================================================
 */

// =============================================================================
// GLOBAL STATE VARIABLES (FOR TOUR PAGE)
// =============================================================================

// Leaflet Map instance dedicated to the tour view
let mapTour = null;

// Leaflet GeoJSON layer currently displayed on the map for the active tour
let currentTourLayer = null;

// Sequentially ordered array of Leaflet marker layers representing tour stops
let tourLayers = [];

// Loaded tour configuration object from data/tour_data.json matching active director
let currentTourData = null;

// Zero-based index tracking the currently active location stop in the tour
let currentTourIndex = 0; 


// =============================================================================
// PAGE CONTROLLERS DICTIONARY
// =============================================================================

/**
 * Route dictionary containing initialization routines keyed by document.body.dataset.page.
 * Automatically executed when the DOM is fully loaded.
 */
const pages = {
    // -------------------------------------------------------------------------
    // CATALOGUE PAGE CONTROLLER (catalogue.html)
    // -------------------------------------------------------------------------
    catalogue: () => {
        // Desktop filter sidebar collapse/expand toggle elements
        const desktopToggleBtn = document.getElementById("desktop_filter_toggle");
        const filterSidebar = document.getElementById("filters_menu");
            
        // Attach click listener to toggle desktop filter sidebar visibility
        if (desktopToggleBtn && filterSidebar) {
            desktopToggleBtn.addEventListener("click", () => {
                filterSidebar.classList.toggle("collapsed-desktop"); // Toggle collapsed class on sidebar
                desktopToggleBtn.classList.toggle("is-open");         // Toggle open state on toggle button
            });
        }

        // Pagination container element
        const paginationContainer = document.getElementById('pagination');
        if (paginationContainer) {
            // Event delegation: handle clicks on pagination buttons (arrows and page numbers)
            paginationContainer.addEventListener('click', (e) => {
                // Find closest button ancestor of the clicked element
                const btn = e.target.closest('button');
                // Ignore clicks that didn't hit a button or hit a disabled button
                if (!btn || btn.disabled) return;

                // Calculate total number of pages based on filtered locations and items per page
                const totalPages = Math.ceil(catalogueState.filteredLocations.length / catalogueState.itemsPerPage) || 1;
                let targetPage = catalogueState.currentPage;

                // Handle Prev/Next arrow navigation (-1 or +1)
                if (btn.classList.contains('arrow')) {
                    const dir = parseInt(btn.dataset.dir, 10);
                    targetPage += dir;
                // Handle numeric page button navigation
                } else if (btn.dataset.page) {
                    targetPage = parseInt(btn.dataset.page, 10);
                }

                // Verify target page is within valid boundaries and differs from active page
                if (targetPage >= 1 && targetPage <= totalPages && targetPage !== catalogueState.currentPage) {
                    // Render requested page
                    displayCataloguePage(targetPage);

                    // Smoothly scroll viewport back to top of catalogue cards section
                    const titleOrCards = document.getElementById('catalogue_page_title') || document.getElementById('cardSection');
                    if (titleOrCards) {
                        titleOrCards.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            });
        }

        // Search input filter listener (real-time filtering)
        const searchInput = document.getElementById("filter_search");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                catalogueState.filters.search = e.target.value.trim();
                applyCatalogueFilters();
            });
        }

        // Sort by select listener
        const sortSelect = document.getElementById("filter_sort");
        if (sortSelect) {
            sortSelect.addEventListener("change", (e) => {
                catalogueState.filters.sortBy = e.target.value;
                applyCatalogueFilters();
            });
        }

        // Director filter listener (cascades to film)
        const directorSelect = document.getElementById("filter_director");
        const filmSelect = document.getElementById("filter_film");
        if (directorSelect) {
            directorSelect.addEventListener("change", (e) => {
                const selectedDirector = e.target.value;
                catalogueState.filters.director = selectedDirector;

                // Cascading update: update film options based on selected director
                const currentFilm = filmSelect ? filmSelect.value : 'all';
                populateFilmOptions(selectedDirector, currentFilm);
                catalogueState.filters.film = filmSelect ? filmSelect.value : 'all';

                applyCatalogueFilters();
            });
        }

        // Film filter listener (syncs director if needed)
        if (filmSelect) {
            filmSelect.addEventListener("change", (e) => {
                const selectedFilm = e.target.value;
                catalogueState.filters.film = selectedFilm;

                // If a specific film is chosen and director is 'all', auto-sync to its director
                if (selectedFilm !== 'all') {
                    const matchedDirector = findDirectorForFilm(selectedFilm);
                    if (matchedDirector && directorSelect && directorSelect.value !== matchedDirector) {
                        directorSelect.value = matchedDirector;
                        catalogueState.filters.director = matchedDirector;
                        populateFilmOptions(matchedDirector, selectedFilm);
                    }
                }

                applyCatalogueFilters();
            });
        }

        // Reset filters button listener
        const resetBtn = document.getElementById("btn_reset_filters");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                resetCatalogueFilters();
            });
        }

        // Asynchronously fetch catalogue locations metadata
        loadScriptJson().then(locations => {
            if (locations && locations.length > 0) {
                // Store loaded locations in state
                catalogueState.allLocations = locations;
                // Dynamically populate filter dropdown options
                populateDirectorOptions();
                populateFilmOptions('all');
                // Apply initial filters and render page 1
                applyCatalogueFilters();
            } else {
                // Fallback to empty state if no locations returned
                catalogueState.allLocations = [];
                catalogueState.filteredLocations = [];
                renderCatalogueCards([]);
            }
        });
    },
    
    // -------------------------------------------------------------------------
    // TOUR PAGE CONTROLLER (tour.html)
    // -------------------------------------------------------------------------
    tour: async () => {
        // Extract 'keyword' query parameter from current URL (keyword is the only supported parameter)
        const urlParams = new URLSearchParams(window.location.search);
        const targetKeyword = urlParams.get('keyword') || 'Jean-Luc Godard';
        
        // Instantiate Leaflet map centered on Paris coordinates [lat, lng] at zoom level 13
        // Default zoom control disabled to position it cleanly in bottom-right
        mapTour = L.map("map", { zoomControl: false }).setView([48.8566, 2.3522], 13);
            
        // Add zoom controls to bottom-right corner
        L.control.zoom({ position: 'bottomright' }).addTo(mapTour);
        // Add OpenStreetMap raster tile layer with zoom bounds and copyright attribution
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            minZoom: 12,
            maxZoom: 17,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mapTour);

        // Load and render active tour
        await loadAndDisplayTour(targetKeyword);

        // Select navigation buttons for both desktop and mobile layouts
        const prevButtons = document.querySelectorAll('#btn-prev, #btn-prev-mobile');
        const nextButtons = document.querySelectorAll('#btn-next, #btn-next-mobile');

        // Attach click listeners to Next buttons: advance stop, fly map camera, update story text
        nextButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (currentTourData && currentTourIndex < currentTourData.locations.length - 1){
                    currentTourIndex++;
                    goToLocation(currentTourIndex);
                    showParagraph(currentTourIndex);
                }
            });
        });

        // Attach click listeners to Prev buttons: move back one stop, fly map camera, update story text
        prevButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (currentTourIndex > 0){
                    currentTourIndex--;
                    goToLocation(currentTourIndex);
                    showParagraph(currentTourIndex);
                }
            });
        });

        // Attach click listener to "Back to first" button: reset tour directly to stop 0
        const backToFirstBtn = document.getElementById('backToFirst');
        if (backToFirstBtn) {
            backToFirstBtn.addEventListener('click', () => {
                currentTourIndex = 0;
                showParagraph(currentTourIndex);
                goToLocation(currentTourIndex);
            });
        }

        // Attach click listeners to tour dropdown options
        const tourOptions = document.querySelectorAll('.tour-option');
        if (tourOptions.length > 0) {
            tourOptions.forEach(option => {
                option.addEventListener('click', async (event) => {
                    const newKeyword = event.target.getAttribute('data-keyword');
                    if (!newKeyword) return;
                    await loadAndDisplayTour(newKeyword);
                });
            });
        }
    }
};


// =============================================================================
// TOUR NAVIGATION & UI HELPERS
// =============================================================================

/**
 * Updates the disabled states of Prev and Next navigation buttons,
 * and controls the visibility and layout animation of the "Back to first" button.
 */
function updateBtnStatus() {
    if (!currentTourData) return;

    // Retrieve desktop and mobile button elements
    const prevButtons = document.querySelectorAll('#btn-prev, #btn-prev-mobile');
    const nextButtons = document.querySelectorAll('#btn-next, #btn-next-mobile');
    const backToFirstBtn = document.getElementById('backToFirst');

    // Disable Prev button if user is on the first stop (index 0)
    prevButtons.forEach(button => {
        button.disabled = (currentTourIndex === 0);
    });

    // Disable Next button if user has reached the final tour stop
    nextButtons.forEach(button => {
        button.disabled = (currentTourIndex === currentTourData.locations.length - 1);
    });

    // Manage visibility and layout preservation for "Back to first" button
    if (backToFirstBtn) {
        if (currentTourIndex === 0) {
            // Measure current height before hiding to avoid abrupt layout shift in container
            const buttonHeight = backToFirstBtn.offsetHeight;
            backToFirstBtn.style.setProperty('display', 'none', 'important');
            const container = document.getElementById('backToFirstContainer');
            if (container && buttonHeight > 0) container.style.height = buttonHeight + 'px';
            backToFirstBtn.style.setProperty('animation', 'fade 1s ease forwards', 'important');
        } else {
            // Show button when beyond the first stop
            backToFirstBtn.style.setProperty('display', 'inline-flex', 'important');    
            const container = document.getElementById('backToFirstContainer');
            if (container) container.style.height = 'auto'; // Reset container height
        }
    }
}

/**
 * Updates the progress bar width based on current tour step completion percentage.
 */
function updateProgressBar() {
    const progress = document.querySelector('.progress-bar');
    if (progress && currentTourData) {
        // Calculate percentage: (currentStep / totalSteps) * 100
        progress.style.width = ((currentTourIndex + 1) / currentTourData.locations.length * 100) + '%';
    }
}

/**
 * Coordinates UI updates when moving to a new tour stop:
 * updates narrative texts, updates button statuses, and recalculates the progress bar.
 * @param {number} newIndex - Index of the newly selected tour stop.
 */
function showParagraph(newIndex) {
    updateLocationTexts(newIndex);
    updateBtnStatus();
    updateProgressBar();
}


// =============================================================================
// DATA FETCHING & FILTERING FUNCTIONS
// =============================================================================

/**
 * Fetches JSON file containing metadata (extended descriptions, photos) for Paris locations.
 * @returns {Promise<Array>} Array of metadata objects, or empty array on error.
 */
function loadScriptJson() {
    return fetch("data/paris_metadata.json")
    .then(function(response) {
        if (!response.ok) throw new Error("HTTP error " + response.status);
        return response.json();
    })
    .catch(function(error) {
        console.error("Fetch error metadata: ", error);
        return [];
    });
};

/**
 * Fetches tour narrative data and populates introductory tour header details
 * (title, description, thematic tags/pills) for the selected director keyword.
 * @param {string} targetKeyword - Director name to find matching tour for.
 * @returns {Promise<Object|null>} Matched tour object or null if not found.
 */
async function loadTourTextData(targetKeyword) {
    try {
        const response = await fetch('data/tour_data.json'); 
        const toursArray = await response.json();

        // Find tour matching the specified director keyword
        let filteredTourData = toursArray.find(tour => tour.keywords === targetKeyword);

        if (filteredTourData) {
            // Update DOM headers and introductory descriptions
            const titleSect = document.getElementById('title-section');
            const descSect = document.getElementById('description-section');
            const pillSecOne = document.getElementById('pillsOneSection');
            const pillSecTwo = document.getElementById('pillsTwoSection');
            const pillSecThree = document.getElementById('pillsThreeSection');

            if (titleSect) titleSect.innerHTML = `${filteredTourData.tour_name}`;
            if (descSect) descSect.innerHTML = `<p>${filteredTourData.description}</p>`;
            // Populate thematic badges/pills
            if (pillSecOne) pillSecOne.innerHTML = `${filteredTourData.pills[0]}`;
            if (pillSecTwo) pillSecTwo.innerHTML = `${filteredTourData.pills[1]}`;
            if (pillSecThree) pillSecThree.innerHTML = `${filteredTourData.pills[2]}`;

            return filteredTourData;
        } else {
            console.warn("Nessun tour trovato per:", targetKeyword);
            return null;
        }
    } catch (error) {
        console.error("Errore nel fetch del file JSON testuale:", error);
        return null;
    }
}

/**
 * Fetches GeoJSON file and filters features array to include only locations
 * associated with the specified tour keyword.
 * @param {string} targetKeyword - Tour keyword used for filtering.
 * @returns {Promise<Object|null>} Filtered GeoJSON object or null on error.
 */
function filteredLoadGeoData(targetKeyword) {
    return fetch("data/paris.geojson")
        .then(function(response){
            if (!response.ok) throw new Error("HTTP error " + response.status);
            return response.json();
        })
        .then(data => {
            // Filter features matching the requested tour keyword
            const filteredFeatures = data.features.filter(feature => 
                    feature.properties &&
                    feature.properties.keywords && 
                    feature.properties.keywords.includes(targetKeyword)
            );
            // Return shallow copy of GeoJSON with filtered features array
            return { ...data, features: filteredFeatures };
        })
        .catch(function(error){
            console.error("Fetch error GeoJSON: ", error);
            return null;
        });
}

/**
 * Normalizes location names for robust matching between tour data and GeoJSON.
 * @param {string} str - String to normalize.
 * @returns {string} Normalized lowercase alphanumeric string.
 */
function normalizeTourName(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/**
 * Evaluates whether a GeoJSON feature name matches a tour location name.
 * @param {string} featName - Feature location name.
 * @param {string} locName - Tour narrative location name.
 * @returns {boolean} True if matched.
 */
function matchTourLocation(featName, locName) {
    const f = normalizeTourName(featName);
    const l = normalizeTourName(locName);
    if (f === l) return true;
    if (f.includes('louvre') && l.includes('louvre')) return true;
    return false;
}

/**
 * Sorts filtered GeoJSON features to strictly match the sequence of tour locations in tour_data.json.
 * @param {Array<Object>} features - Filtered GeoJSON features array.
 * @param {Array<Object>} tourLocations - Sequential tour locations array.
 * @returns {Array<Object>} Sorted GeoJSON features array.
 */
function sortFeaturesByTourOrder(features, tourLocations) {
    if (!features || !tourLocations) return features;
    return [...features].sort((a, b) => {
        const nameA = a.properties && a.properties.name;
        const nameB = b.properties && b.properties.name;
        const idxA = tourLocations.findIndex(loc => matchTourLocation(nameA, loc.location_name));
        const idxB = tourLocations.findIndex(loc => matchTourLocation(nameB, loc.location_name));
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
}

/**
 * Central controller to load, sort, and render an entire tour by keyword.
 * Updates narrative texts, sorts and maps GeoJSON markers, and syncs URL query params.
 * @param {string} keyword - Tour keyword identifying the tour.
 */
async function loadAndDisplayTour(keyword) {
    const targetKeyword = keyword || 'Jean-Luc Godard';

    // Update dropdown toggle button label
    const dropdownButton = document.getElementById('tourDropdownMenuButton');
    if (dropdownButton) {
        dropdownButton.textContent = targetKeyword;
    }

    // Clean up previously active tour markers layer
    if (currentTourLayer && mapTour) {
        mapTour.removeLayer(currentTourLayer);
        currentTourLayer = null;
    }
    tourLayers = [];

    // 1. Fetch textual narrative content and tour metadata
    currentTourData = await loadTourTextData(targetKeyword);
    currentTourIndex = 0;

    // 2. Fetch GeoJSON locations filtered by keyword and ordered by tour sequence
    const geoData = await filteredLoadGeoData(targetKeyword);
    if (geoData && currentTourData && currentTourData.locations) {
        geoData.features = sortFeaturesByTourOrder(geoData.features, currentTourData.locations);
    }

    // 3. Render markers on map
    if (geoData) {
        addGeoDataTour(geoData);
    }

    // 4. If tour data contains locations, render initial location story paragraph
    if (currentTourData && currentTourData.locations.length > 0) {
        showParagraph(0);
    }
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('keyword', targetKeyword);
    window.history.pushState({}, '', newUrl);
}


// =============================================================================
// TOUR MAP RENDERING & ANIMATION
// =============================================================================

/**
 * Renders filtered GeoJSON features onto the map, binds popups,
 * stores marker layers into the ordered tourLayers array, and navigates to stop 0.
 * @param {Object} geojson - Filtered GeoJSON feature collection.
 */
function addGeoDataTour(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) return;
    tourLayers = []; // Reset tour layers array

    if (currentTourLayer && mapTour) {
        mapTour.removeLayer(currentTourLayer);
        currentTourLayer = null;
    }

    // Instantiate GeoJSON layer and collect markers sequentially
    currentTourLayer = L.geoJSON(geojson, {
        onEachFeature: function (feature, layer) {
            layer.bindPopup(createPopupContentTour(feature)); // Bind card popup
            const stopIndex = tourLayers.length;
            // Clicking a marker synchronizes the narrative story and navigation state
            layer.on('click', function () {
                currentTourIndex = stopIndex;
                showParagraph(stopIndex);
                goToLocation(stopIndex);
            });
            tourLayers.push(layer); // Store layer reference in sequential tour order
        }
    }).addTo(mapTour);

    // If locations were loaded, fly camera directly to the first stop
    if (tourLayers.length > 0) {
        goToLocation(0);
    }
}

/**
 * Smoothly animates the map viewport camera (flyTo) to the coordinates
 * of the tour stop at the given index, and opens its marker popup.
 * @param {number} index - Index of the target location in tourLayers.
 */
function goToLocation(index) {
    if (!tourLayers[index]) return;
    const targetLayer = tourLayers[index];
    // Smooth flight animation to marker coordinates at zoom 16 over 1.5 seconds
    mapTour.flyTo(targetLayer.getLatLng(), 16, { animate: true, duration: 1.5 });
    targetLayer.openPopup(); // Display marker popup card
}

/**
 * Generates HTML string for a Leaflet marker popup card on the tour map.
 * @param {Object} feature - GeoJSON feature representing a film location.
 * @returns {string} HTML markup for the popup card.
 */
function createPopupContentTour(feature) {
    var props = feature.properties || {};
    var movie = (props.movies && props.movies.join(', ')) || props.movie || 'N/A';
    return `<div class="card" style="width: 18rem;">
                <div class="card-body">
                    <h5 class="card-title">${props.name || 'Location'}</h5>
                    <p class="card-text m-0"><b>Associated Film:</b> ${movie}</p>
                </div>
            </div>`;
}

/**
 * Updates the text-section DOM container with the story and title
 * of the currently active tour stop.
 * @param {number} index - Tour stop index.
 */
function updateLocationTexts(index) {
    if (!currentTourData || !currentTourData.locations[index]) return;
    const currentLocation = currentTourData.locations[index];
    const textInfo = document.getElementById('text-section');
    const mapTourUrl = `map.html?location=${encodeURIComponent(currentLocation.location_name)}`;
    if (textInfo) {
        // Inject location heading and descriptive historical narrative text
        textInfo.innerHTML = `
            <h3>${currentLocation.location_name}</h3>
            <p>${currentLocation.text}</p>
            <a href="${mapTourUrl}" id="backToMapTour"class="btn btn-primary mt-2 mb-3">Go to the Location on the Map</a>
        `;
    }
}


// =============================================================================
// CATALOGUE STATE & PAGINATION LOGIC (catalogue.html)
// =============================================================================

/**
 * Reactive state object tracking catalogue items, active filters, and pagination status.
 */
const catalogueState = {
    allLocations: [],      // Complete array of fetched location objects
    filteredLocations: [], // Processed array after search, filter & sort
    currentPage: 1,        // Currently displayed page number (1-indexed)
    itemsPerPage: 9,       // Number of location cards displayed per page
    filters: {
        search: '',
        director: 'all',
        film: 'all',
        sortBy: 'default'
    }
};

/**
 * Safely extracts the associated movies array for a given location.
 * @param {Object} loc - Location object.
 * @returns {Array<Object>}
 */
function getMoviesForLocation(loc) {
    return (loc && Array.isArray(loc.associated_movie)) ? loc.associated_movie : [];
}

/**
 * Extracts a sorted array of unique director names from the loaded locations.
 * @param {Array<Object>} locations
 * @returns {Array<string>}
 */
function getUniqueDirectors(locations) {
    const directors = new Set();
    locations.forEach(loc => {
        getMoviesForLocation(loc).forEach(m => {
            if (m.director && m.director.trim()) {
                directors.add(m.director.trim());
            }
        });
    });
    return Array.from(directors).sort((a, b) => a.localeCompare(b));
}

/**
 * Extracts a sorted array of unique film names, optionally filtered by director.
 * @param {Array<Object>} locations
 * @param {string} directorFilter - 'all' or specific director name.
 * @returns {Array<string>}
 */
function getUniqueFilms(locations, directorFilter = 'all') {
    const films = new Set();
    locations.forEach(loc => {
        getMoviesForLocation(loc).forEach(m => {
            if (m.film_name && m.film_name.trim()) {
                if (directorFilter === 'all' || m.director === directorFilter) {
                    films.add(m.film_name.trim());
                }
            }
        });
    });
    return Array.from(films).sort((a, b) => a.localeCompare(b));
}

/**
 * Finds the director associated with a specific film title.
 * @param {string} filmName
 * @returns {string|null}
 */
function findDirectorForFilm(filmName) {
    for (const loc of catalogueState.allLocations) {
        for (const m of getMoviesForLocation(loc)) {
            if (m.film_name === filmName && m.director) {
                return m.director;
            }
        }
    }
    return null;
}

/**
 * Populates the Director select dropdown options dynamically.
 */
function populateDirectorOptions() {
    const directorSelect = document.getElementById('filter_director');
    if (!directorSelect) return;
    const directors = getUniqueDirectors(catalogueState.allLocations);
    const currentVal = directorSelect.value;

    directorSelect.innerHTML = '<option value="all">All directors</option>';
    directors.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        directorSelect.appendChild(opt);
    });

    if (directors.includes(currentVal)) {
        directorSelect.value = currentVal;
    } else {
        directorSelect.value = 'all';
    }
}

/**
 * Populates the Film select dropdown options dynamically based on the active director.
 * @param {string} selectedDirector - Active director or 'all'.
 * @param {string} preserveFilm - Film value to preserve if still valid.
 */
function populateFilmOptions(selectedDirector = 'all', preserveFilm = '') {
    const filmSelect = document.getElementById('filter_film');
    if (!filmSelect) return;
    const films = getUniqueFilms(catalogueState.allLocations, selectedDirector);

    filmSelect.innerHTML = '<option value="all">All films</option>';
    films.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        filmSelect.appendChild(opt);
    });

    if (preserveFilm && films.includes(preserveFilm)) {
        filmSelect.value = preserveFilm;
    } else {
        filmSelect.value = 'all';
    }
}

/**
 * Computes min or max film production year associated with a location.
 * @param {Object} loc - Location object.
 * @param {'min'|'max'} mode
 * @returns {number}
 */
function getFilmYearForLocation(loc, mode = 'max') {
    const movies = getMoviesForLocation(loc);
    const years = movies
        .map(m => parseInt(m.production_year, 10))
        .filter(y => !isNaN(y));
    if (years.length === 0) {
        return mode === 'max' ? -Infinity : Infinity;
    }
    return mode === 'max' ? Math.max(...years) : Math.min(...years);
}

/**
 * Normalizes a string for diacritic-insensitive and case-insensitive comparison.
 * @param {string} str
 * @returns {string}
 */
function normalizeSearchText(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * Evaluates active filter criteria, sorts the results, updates filteredLocations,
 * and displays the first page.
 */
function applyCatalogueFilters() {
    const { search, director, film, sortBy } = catalogueState.filters;
    const normalizedQuery = normalizeSearchText(search);

    let result = catalogueState.allLocations.filter(loc => {
        const movies = getMoviesForLocation(loc);

        // 1. Director filter
        if (director !== 'all') {
            const hasDirector = movies.some(m => m.director === director);
            if (!hasDirector) return false;
        }

        // 2. Film filter
        if (film !== 'all') {
            const hasFilm = movies.some(m => m.film_name === film);
            if (!hasFilm) return false;
        }

        // 3. Search query filter
        if (normalizedQuery) {
            const name = normalizeSearchText(loc.location_name);
            const descAdult = normalizeSearchText(loc.tones && loc.tones.adult && loc.tones.adult.simple_description);
            const descMed = normalizeSearchText(loc.medium_description);
            const curiosity = normalizeSearchText(loc.curiosity);
            const matchesMovie = movies.some(m => 
                normalizeSearchText(m.film_name).includes(normalizedQuery) ||
                normalizeSearchText(m.director).includes(normalizedQuery) ||
                normalizeSearchText(m.starring).includes(normalizedQuery)
            );

            const matchesText = name.includes(normalizedQuery) ||
                                descAdult.includes(normalizedQuery) ||
                                descMed.includes(normalizedQuery) ||
                                curiosity.includes(normalizedQuery) ||
                                matchesMovie;

            if (!matchesText) return false;
        }

        return true;
    });

    // 4. Sorting
    result = sortCatalogueLocations(result, sortBy);

    catalogueState.filteredLocations = result;
    displayCataloguePage(1);
}

/**
 * Sorts location objects based on selected sort criteria.
 * @param {Array<Object>} locations
 * @param {string} sortBy
 * @returns {Array<Object>}
 */
function sortCatalogueLocations(locations, sortBy) {
    const list = [...locations];
    switch (sortBy) {
        case 'name-asc':
            list.sort((a, b) => (a.location_name || '').localeCompare(b.location_name || ''));
            break;
        case 'name-desc':
            list.sort((a, b) => (b.location_name || '').localeCompare(a.location_name || ''));
            break;
        case 'year-desc':
            list.sort((a, b) => {
                const yearDiff = getFilmYearForLocation(b, 'max') - getFilmYearForLocation(a, 'max');
                if (yearDiff !== 0) return yearDiff;
                return (a.location_name || '').localeCompare(b.location_name || '');
            });
            break;
        case 'year-asc':
            list.sort((a, b) => {
                const yearDiff = getFilmYearForLocation(a, 'min') - getFilmYearForLocation(b, 'min');
                if (yearDiff !== 0) return yearDiff;
                return (a.location_name || '').localeCompare(b.location_name || '');
            });
            break;
        case 'default':
        default:
            list.sort((a, b) => {
                const idxA = catalogueState.allLocations.indexOf(a);
                const idxB = catalogueState.allLocations.indexOf(b);
                return idxA - idxB;
            });
            break;
    }
    return list;
}

/**
 * Resets all catalogue filters, search query, and sorting back to default.
 */
function resetCatalogueFilters() {
    catalogueState.filters.search = '';
    catalogueState.filters.director = 'all';
    catalogueState.filters.film = 'all';
    catalogueState.filters.sortBy = 'default';

    const searchInput = document.getElementById('filter_search');
    const sortSelect = document.getElementById('filter_sort');
    const directorSelect = document.getElementById('filter_director');
    const filmSelect = document.getElementById('filter_film');

    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'default';
    if (directorSelect) directorSelect.value = 'all';
    populateFilmOptions('all');
    if (filmSelect) filmSelect.value = 'all';

    applyCatalogueFilters();
}

/**
 * Calculates page slices, renders the location card grid for the target page,
 * updates the catalogue header counter, and re-renders pagination controls.
 * @param {number} page - Page number to navigate to.
 */
function displayCataloguePage(page) {
    const totalItems = catalogueState.filteredLocations.length;
    const totalAll = catalogueState.allLocations.length;
    // Calculate total pages (fallback to 1 if no items)
    const totalPages = Math.ceil(totalItems / catalogueState.itemsPerPage) || 1;

    // Enforce page boundaries
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    catalogueState.currentPage = page;

    // Calculate array slice indices for the current page
    const startIndex = (page - 1) * catalogueState.itemsPerPage;
    const endIndex = Math.min(startIndex + catalogueState.itemsPerPage, totalItems);
    const pageLocations = catalogueState.filteredLocations.slice(startIndex, endIndex);

    // Render location cards for this page slice
    renderCatalogueCards(pageLocations);

    // Update the catalogue section title with item and page counters
    const catalogueTitle = document.querySelector("#catalogue_page_title h2");
    if (catalogueTitle) {
        if (totalItems === 0) {
            catalogueTitle.textContent = "0 locations shown";
        } else if (totalItems === 1) {
            catalogueTitle.textContent = totalAll > 1
                ? `1 of ${totalAll} locations shown (Page 1 of 1)`
                : `1 location shown (Page 1 of 1)`;
        } else if (totalItems !== totalAll) {
            catalogueTitle.textContent = `${totalItems} of ${totalAll} locations shown (Page ${page} of ${totalPages})`;
        } else {
            catalogueTitle.textContent = `${totalItems} locations shown (Page ${page} of ${totalPages})`;
        }
    }

    // Rebuild pagination buttons for current page state
    renderPagination(totalPages, page);
}

/**
 * Generates an array of page numbers and ellipsis strings ('...')
 * implementing a smart sliding window around the active page.
 * @param {number} current - Currently active page number.
 * @param {number} total - Total number of pages.
 * @returns {Array<number|string>} Array containing page numbers and ellipses.
 */
function getPaginationRange(current, total) {
    // If 7 or fewer pages, display all page numbers directly without ellipses
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    const showLeftEllipsis = current > 4;          // Need ellipsis on left if beyond page 4
    const showRightEllipsis = current < total - 3; // Need ellipsis on right if before total - 3

    // Case 1: Near the beginning (no left ellipsis, right ellipsis active)
    if (!showLeftEllipsis && showRightEllipsis) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...');
        pages.push(total);
    // Case 2: Near the end (left ellipsis active, no right ellipsis)
    } else if (showLeftEllipsis && !showRightEllipsis) {
        pages.push(1);
        pages.push('...');
        for (let i = total - 4; i <= total; i++) pages.push(i);
    // Case 3: In the middle (both left and right ellipses active)
    } else {
        pages.push(1);
        pages.push('...');
        pages.push(current - 1);
        pages.push(current);
        pages.push(current + 1);
        pages.push('...');
        pages.push(total);
    }
    return pages;
}

/**
 * Generates and appends HTML pagination buttons (Previous arrow, page numbers,
 * ellipses, and Next arrow) inside the #pagination container element.
 * @param {number} totalPages - Total count of available pages.
 * @param {number} currentPage - Currently active page number.
 */
function renderPagination(totalPages, currentPage) {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;

    // Clear previous pagination elements
    paginationContainer.innerHTML = '';

    if (totalPages < 1) return;

    // Create Previous page arrow button («)
    const prevBtn = document.createElement('button');
    prevBtn.className = 'arrow';
    prevBtn.dataset.dir = '-1';
    prevBtn.innerHTML = '&laquo;';
    prevBtn.setAttribute('aria-label', 'Previous page');
    // Disable Previous button if already on the first page
    if (currentPage <= 1) {
        prevBtn.disabled = true;
    }
    paginationContainer.appendChild(prevBtn);

    // Calculate smart pagination range array
    const pageRange = getPaginationRange(currentPage, totalPages);
    pageRange.forEach(item => {
        // If item is an ellipsis separator, render span element
        if (item === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.textContent = '...';
            paginationContainer.appendChild(ellipsis);
        // Otherwise render numeric page button
        } else {
            const pageBtn = document.createElement('button');
            pageBtn.className = `page-num${item === currentPage ? ' active' : ''}`;
            pageBtn.dataset.page = item;
            pageBtn.textContent = item;
            pageBtn.setAttribute('aria-label', `Page ${item}`);
            // Set accessibility attribute on active page
            if (item === currentPage) {
                pageBtn.setAttribute('aria-current', 'page');
            }
            paginationContainer.appendChild(pageBtn);
        }
    });

    // Create Next page arrow button (»)
    const nextBtn = document.createElement('button');
    nextBtn.className = 'arrow';
    nextBtn.dataset.dir = '1';
    nextBtn.innerHTML = '&raquo;';
    nextBtn.setAttribute('aria-label', 'Next page');
    // Disable Next button if already on the last page
    if (currentPage >= totalPages) {
        nextBtn.disabled = true;
    }
    paginationContainer.appendChild(nextBtn);
}

/**
 * Builds and renders the Bootstrap responsive card grid representing locations on the current page.
 * @param {Array<Object>} locations - Array of location objects to display.
 */
function renderCatalogueCards(locations) {
    const cardSection = document.getElementById("cardSection") || document.querySelector(".row_catalogue");
    if (!cardSection) return;

    // Clear existing cards
    cardSection.innerHTML = "";
    

    // Empty state fallback when no locations match
    if (!locations || locations.length === 0) {
        cardSection.innerHTML = `
            <div class="col-12 text-center py-5">
                <span class="material-symbols-outlined" style="font-size: 3.5rem; opacity: 0.6;">search_off</span>
                <h3 class="mt-3 mb-2">No locations found</h3>
                <p class="lead mb-4">No locations match your filter or search criteria.</p>
                <button type="button" class="btn btn-outline-secondary" id="btn_empty_reset">
                    Reset all filters
                </button>
            </div>
        `;
        const emptyResetBtn = document.getElementById('btn_empty_reset');
        if (emptyResetBtn) {
            emptyResetBtn.addEventListener('click', () => {
                resetCatalogueFilters();
            });
        }
        return;
    }

    // Iterate through location objects and construct card column elements
    locations.forEach(location => {
        const col = document.createElement("div");
        // Responsive Bootstrap column classes: 1 card per row on mobile, 2 on tablet, 3 on desktop
        col.className = "col-sm-12 col-md-6 col-lg-4 col-xl-4";

        const imgUrl = location.image_url || "img/generic_bg.png";
        const title = location.location_name || "Location";
        const desc = (location.tones && location.tones.adult && location.tones.adult.simple_description) || location.medium_description || "";
        const mapUrl = `map.html?location=${encodeURIComponent(location.location_name || '')}`;

        // Build HTML template for the location card with image fallback and link to map
        col.innerHTML = `
            <div class="card border rounded h-100">
                <img src="${imgUrl}" class="img-fluid" alt="${title}" onerror="this.onerror=null;this.src='img/generic_bg.png';">
                <h5 class="ps-2 my-2 mx-1">${title}</h5>
                <p class="ps-2 my-2 mx-1">${desc}</p>
                <a href="${mapUrl}" class="card_link align-self-end mt-auto pe-2 my-2 mx-1 d-flex align-items-center">
                    Go to the map<span class="material-symbols-outlined arrow_forward_ios card_arrow">arrow_forward_ios</span>
                </a>
            </div>
        `;
        cardSection.appendChild(col);
    });
}


// =============================================================================
// GLOBAL APPLICATION LIFECYCLE & THEME SWITCHER
// =============================================================================

/**
 * Global entry point executed upon DOMContentLoaded:
 * 1. Checks and restores custom theme from localStorage.
 * 2. Initializes interactive theme switcher menu and event listeners.
 * 3. Identifies active page via body[data-page] and executes corresponding controller.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Read active page identifier attribute from body (e.g. data-page="catalogue" or data-page="tour")
    const currentPage = document.body.dataset.page;    

    // Theme switcher UI control elements
    const closeThemeBtn = document.querySelector('.closeTheme');
    const openThemeMenu = document.querySelector('.openTheme');
    const linkCSS = document.getElementById('stylesheet_file');

    // Restore previously saved theme from browser localStorage if present
    if (linkCSS) {
        const savedTheme = localStorage.getItem('fileTheme');
        if (savedTheme) {
            linkCSS.setAttribute('href', savedTheme);
        }
    }

    // Set up theme switcher menu click interactions
    if (closeThemeBtn && openThemeMenu) {
        // Clicking floating theme button opens the theme selection menu
        closeThemeBtn.addEventListener('click', () => {
            closeThemeBtn.style.display = 'none';
            openThemeMenu.style.display = 'block';
        });

        // Event delegation inside the opened theme menu container
        openThemeMenu.addEventListener('click', (event) => {
            // Handle clicking a specific theme option button (.btn-tema)
            const btnTema = event.target.closest('.btn-tema');
            if (btnTema) {
                event.stopPropagation(); 
                const choosenFile = btnTema.getAttribute('data-file');
                // Apply chosen CSS file and persist choice in localStorage
                if (choosenFile && linkCSS) {
                    linkCSS.setAttribute('href', choosenFile);
                    localStorage.setItem('fileTheme', choosenFile);
                }
                // Close menu and restore open button
                openThemeMenu.style.display = 'none';
                closeThemeBtn.style.display = 'block';
                return;
            }

            // Handle clicking the close button (.btn-chiudi) inside the menu
            const btnChiudiMenu = event.target.closest('.btn-chiudi');
            if (btnChiudiMenu) {
                event.stopPropagation();
                openThemeMenu.style.display = 'none';
                closeThemeBtn.style.display = 'block';
            }
        });
    }
    
    // If active page has a matching controller defined in pages dictionary, invoke it
    if (currentPage && pages[currentPage]) {
        pages[currentPage]();
    }
});