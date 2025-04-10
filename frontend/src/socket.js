import { io } from "socket.io-client"

export function initSocket() {
	// Check if we're in a browser environment
	if (typeof window === 'undefined') {
		return null;
	}

	try {
		let host = window.location.hostname;
		let siteName = window.site_name || '';
		let protocol = window.location.protocol === 'https:' ? 'https' : 'http';
		
		// Use the current domain for socket connection
		let url = `${protocol}://${host}`;
		
		console.log('Initializing socket connection to:', url);
		
		let socket = io(url, {
			withCredentials: true,
			reconnectionAttempts: 5,
			path: '/socket.io'
		});

		socket.on("connect", () => {
			console.log('Socket connected successfully');
		});

		socket.on("connect_error", (error) => {
			console.warn('Socket connection error:', error.message);
		});

		socket.on("hrms:refetch_resource", (data) => {
			console.log('Received refetch resource event:', data);
			if (data.cache_key) {
				let resource = window.frappe?.getCachedResource?.(data.cache_key) ||
							  window.frappe?.getCachedListResource?.(data.cache_key);

				if (resource) {
					resource.reload();
				}
			}
		});

		return socket;
	} catch (error) {
		console.error('Error initializing socket:', error);
		return null;
	}
}
