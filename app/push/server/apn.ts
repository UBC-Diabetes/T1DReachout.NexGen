import apn from 'apn';
import { EJSON } from 'meteor/ejson';

import { logger } from './logger';

let apnConnection;

export const sendAPN = ({ userToken, notification, _removeToken }): void => {
	logger.error('sendAPN called for token:', userToken.substring(0, 10) + '...');
	console.log('[DEBUG] sendAPN called for token:', userToken.substring(0, 10) + '...');
	if (typeof notification.apn === 'object') {
		notification = Object.assign({}, notification, notification.apn);
	}

	const hasPriority = notification.priority === 0 || Boolean(notification.priority);
	const priority = hasPriority ? notification.priority : 10;

	const note = new apn.Notification();

	note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
	note.badge = notification.badge;
	note.sound = notification.sound;

	if (notification.contentAvailable != null) {
		note.setContentAvailable(notification.contentAvailable);
	}

	// adds category support for iOS8 custom actions as described here:
	// https://developer.apple.com/library/ios/documentation/NetworkingInternet/Conceptual/
	// RemoteNotificationsPG/Chapters/IPhoneOSClientImp.html#//apple_ref/doc/uid/TP40008194-CH103-SW36
	note.category = notification.category;

	note.body = notification.text;
	note.title = notification.title;

	if (notification.notId != null) {
		note.threadId = String(notification.notId);
	}

	// Allow the user to set payload data
	note.payload = notification.payload
		? { ejson: EJSON.stringify(notification.payload) }
		: {};

	note.payload.messageFrom = notification.from;
	note.priority = priority;

	// Store the token on the note so we can reference it if there was an error
	note.token = userToken;
	note.topic = notification.topic;
	note.mutableContent = 1;

	logger.error('APN notification details - topic:', notification.topic, 'title:', notification.title, 'body:', notification.text);
	console.log('[DEBUG] APN notification details - topic:', notification.topic, 'title:', notification.title, 'body:', notification.text);

	if (!apnConnection) {
		logger.error('APN connection is undefined. Skipping APN send.');
		return;
	}
	logger.error('APN connection status:', !!apnConnection);
	console.log('[DEBUG] APN connection status:', !!apnConnection);

	try {
		if (!apnConnection) { throw new Error('APN connection is undefined'); }

		logger.error('Sending APN notification to Apple, token:', userToken.substring(0, 10) + '...');
		console.log('[DEBUG] Sending APN notification to Apple, token:', userToken.substring(0, 10) + '...');
		apnConnection.send(note, userToken).then((response) => {
			logger.error('APN response from Apple - sent:', response.sent.length, 'failed:', response.failed.length);
			console.log('[DEBUG] APN response from Apple - sent:', response.sent.length, 'failed:', response.failed.length);
			response.failed.forEach((failure) => {
				logger.error(`Apple rejected notification - error code ${ failure.status } reason: ${ failure.response?.reason } for token ${ userToken }`);
				console.log(`[DEBUG] Apple rejected notification - error code ${ failure.status } reason: ${ failure.response?.reason } for token ${ userToken }`);
				logger.error('Full failure object:', JSON.stringify(failure, null, 2));
				console.log('[DEBUG] Full failure object:', JSON.stringify(failure, null, 2));

				if (['400', '410'].includes(failure.status)) {
					logger.debug(`Removing token ${ userToken }`);
					_removeToken({
						apn: userToken,
					});
				}
			});
			if (response.sent.length > 0) {
				logger.error('Apple accepted notification successfully');
				console.log('[DEBUG] Apple accepted notification successfully');
			}
		});
	} catch (e) {
		logger.error('Error sending APN notification');
		logger.error(e);
	}
};

export const initAPN = ({ options, absoluteUrl }): void => {
	logger.debug('APN configured');
	logger.info('APN init: cert length:', options.apn?.cert?.length);
	logger.info('APN init: key length:', options.apn?.key?.length);

	// Allow production to be a general option for push notifications
	if (options.production === Boolean(options.production)) {
		options.apn.production = options.production;
	}

	// Give the user warnings about development settings
	if (options.apn.development) {
		// This flag is normally set by the configuration file
		logger.warn('WARNING: Push APN is using development key and certificate');
	} else if (options.apn.gateway) {
		// We check the apn gateway i the options, we could risk shipping
		// server into production while using the production configuration.
		// On the other hand we could be in development but using the production
		// configuration. And finally we could have configured an unknown apn
		// gateway (this could change in the future - but a warning about typos
		// can save hours of debugging)
		//
		// Warn about gateway configurations - it's more a guide

		if (options.apn.gateway === 'gateway.sandbox.push.apple.com') {
			// Using the development sandbox
			logger.warn('WARNING: Push APN is in development mode');
		} else if (options.apn.gateway === 'gateway.push.apple.com') {
			// In production - but warn if we are running on localhost
			if (/http:\/\/localhost/.test(absoluteUrl)) {
				logger.warn(
					'WARNING: Push APN is configured to production mode - but server is running from localhost',
				);
			}
		} else {
			// Warn about gateways we dont know about
			logger.warn(`WARNING: Push APN unknown gateway "${ options.apn.gateway }"`);
		}
	} else if (options.apn.production) {
		if (/http:\/\/localhost/.test(absoluteUrl)) {
			logger.warn(
				'WARNING: Push APN is configured to production mode - but server is running from localhost',
			);
		}
	} else {
		logger.warn('WARNING: Push APN is in development mode');
	}

	// Check certificate data
	if (!options.apn.cert || !options.apn.cert.length) {
		logger.error('ERROR: Push server could not find cert');
	}

	// Check key data
	if (!options.apn.key || !options.apn.key.length) {
		logger.error('ERROR: Push server could not find key');
	}

	// Rig apn connection
	try {
		logger.error('Creating new APN Provider with options:', JSON.stringify(options.apn, null, 2));
		console.log('[DEBUG] Creating new APN Provider with options:', JSON.stringify(options.apn, null, 2));
		apnConnection = new apn.Provider(options.apn);
		logger.error('APN Provider created successfully:', !!apnConnection);
		console.log('[DEBUG] APN Provider created successfully:', !!apnConnection);
		
		// Log provider configuration details
		logger.error('APN Provider config - production:', options.apn.production, 'gateway:', options.apn.gateway);
		console.log('[DEBUG] APN Provider config - production:', options.apn.production, 'gateway:', options.apn.gateway);
	} catch (e) {
		logger.error('Error trying to initialize APN');
		logger.error(e);
		console.log('[DEBUG] Error trying to initialize APN:', e);
	}
	if (!apnConnection) {
		logger.warn('APN push skipped: no connection available');
		console.log('[DEBUG] APN push skipped: no connection available');
	}
};
