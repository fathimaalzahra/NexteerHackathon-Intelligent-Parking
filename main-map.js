// Global variables
let mainPageMap;
let mainPageMarkers = []; // Keep track of markers to close info windows
let mapInitialized = false; // Flag to ensure map is initialized only once

// This function is called by the Google Maps API script once it's loaded
function initMainPageMap() {
    console.log("initMainPageMap called: Google Maps API loaded.");

    const showMapButton = document.getElementById('showMapButton');
    const mapContainer = document.getElementById('parkingMapContainer');

    if (showMapButton && mapContainer) {
        showMapButton.addEventListener('click', () => {
            console.log("Show Parking Map button clicked.");
            // Toggle map visibility
            if (mapContainer.style.display === 'none') {
                mapContainer.style.display = 'block';
                // Initialize map only if not already done
                if (!mapInitialized) {
                    console.log("Map not yet initialized. Creating map and loading markers.");
                    createAndLoadParkingMap();
                    mapInitialized = true;
                } else {
                    console.log("Map already initialized. Just showing and resizing.");
                    // If map already initialized and just toggled visibility,
                    // sometimes it needs a resize event to display correctly.
                    google.maps.event.trigger(mainPageMap, 'resize');
                    mainPageMap.setCenter(mainPageMap.getCenter()); // Recenter if needed
                }
                showMapButton.textContent = 'Hide Parking Map'; // Change button text
            } else {
                console.log("Hiding parking map.");
                mapContainer.style.display = 'none';
                showMapButton.textContent = 'Show Parking Map'; // Change button text
            }
        });
    } else {
        console.error("ERROR: Map button or container (parkingMapContainer) not found on the page. Check index.html IDs.");
    }
}

// Function to create the map and add markers
async function createAndLoadParkingMap() {
    // Define the default center for the map (e.g., center of Bangalore)
    const defaultCenter = { lat: 12.9716, lng: 77.5946 };

    mainPageMap = new google.maps.Map(document.getElementById("parkingMapContainer"), {
        center: defaultCenter,
        zoom: 12, // Adjust initial zoom level
    });

    console.log("Map instance created for #parkingMapContainer.");

    try {
        console.log("Attempting to fetch parking locations from /api/locations...");
        const response = await fetch('http://localhost:3000/api/locations');
        
        if (!response.ok) {
            // If the response is not OK (e.g., 404, 500), throw an error
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const locations = await response.json(); // THIS IS LINE 69
        console.log("Successfully fetched locations:", locations);
        
        // Filter for only KR Circle and Indiranagar
        const filteredLocations = locations.filter(loc => 
            loc.id === 'kr_circle' || loc.id === 'indiranagar'
        );

        if (filteredLocations.length === 0) {
            console.warn("No KR Circle or Indiranagar locations found in the fetched data. Check server.js parkingData and API response.");
        }

        const bounds = new google.maps.LatLngBounds(); // To fit all markers on screen

        filteredLocations.forEach(location => {
            if (location.lat && location.lng) {
                console.log(`Adding marker for: ${location.name} at (${location.lat}, ${location.lng})`);
                addParkingMarkerToMap(location);
                bounds.extend({ lat: location.lat, lng: location.lng });
            } else {
                console.error(`Skipping marker for ${location.name}: Missing latitude or longitude.`);
            }
        });

        // Adjust map bounds to fit all filtered markers
        if (filteredLocations.length > 0) {
            mainPageMap.fitBounds(bounds);
            console.log("Map bounds adjusted to fit markers.");
        }

    } catch (error) {
        // This is the line that was showing the error in your console
        console.error("Error fetching parking locations for main map:", error);
    }
}

function addParkingMarkerToMap(parkingLot) {
    const marker = new google.maps.Marker({
        position: { lat: parkingLot.lat, lng: parkingLot.lng },
        map: mainPageMap, // Use the mainPageMap
        title: parkingLot.name,
        // You can add a custom icon if you want, e.g.:
        // icon: 'http://maps.google.com/mapfiles/ms/icons/parkinglot.png'
    });

    mainPageMarkers.push(marker); // Add to our list for info window management

    const infoContent = `
        <div class="info-content">
            <h3>${parkingLot.name}</h3>
            <p>Total Slots: ${parkingLot.total}</p>
            <p>Available Slots: ${parkingLot.available}</p>
            <button onclick="navigateToParking('${parkingLot.name}', ${parkingLot.lat}, ${parkingLot.lng})">
                Navigate Here
            </button>
        </div>
    `;

    const infoWindow = new google.maps.InfoWindow({
        content: infoContent,
    });

    marker.addListener("click", () => {
        // Close any currently open info windows
        mainPageMarkers.forEach(m => {
            if (m.infoWindow) m.infoWindow.close();
        });
        infoWindow.open(mainPageMap, marker);
        marker.infoWindow = infoWindow; // Attach infoWindow to marker for later closing
        console.log(`Info window opened for ${parkingLot.name}`);
    });
}

// Function to open Google Maps for navigation
function navigateToParking(locationName, lat, lng) {
    console.log(`Navigating to: ${locationName} (${lat}, ${lng})`);
    const destination = `${lat},${lng}`;
    // Using Google Maps' directions URL
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
    window.open(url, '_blank'); // Opens in a new tab
}

// Make initMainPageMap and navigateToParking globally accessible
window.initMainPageMap = initMainPageMap;
window.navigateToParking = navigateToParking; // Needed for onclick in info window