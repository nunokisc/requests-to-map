# requests-to-map

This project processes nginx access logs in two steps:

1º Group by ip and sum all requests by ip

2º Get geolocation of all ips

In the end you can see all processed requets in map

# Run
    npm install
    
    node main.js

    After: http://localhost:3000/
