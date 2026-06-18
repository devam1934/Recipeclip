# RecipeClip — Privacy Policy

_Last updated: June 18, 2026_

RecipeClip is a Chrome extension that turns a YouTube cooking video into an
editable recipe card. This policy explains exactly what data the extension
handles.

## What we collect

When you click **Get recipe** on a YouTube watch page, the extension reads the
current video's **title, description, and transcript** (publicly visible page
content) and sends that text to the RecipeClip backend. The backend passes the
text to an AI service (Google Gemini) to organize it into a structured recipe,
then returns the recipe to your browser.

That video text is the **only** data sent off your device, and only when you
explicitly click Get recipe.

## What we do NOT collect

We do not collect or transmit:

- Names, email addresses, or any personally identifiable information
- Passwords, credentials, or authentication data
- Financial, payment, or health information
- Location data
- Your browsing history or a record of pages you visit
- Keystrokes, mouse movement, or other activity tracking

The extension has no account or login.

## Data stored on your device

Recipes you save and your ingredient/step checklist progress are stored locally
in your browser using `chrome.storage.local`. This data never leaves your device
and is not accessible to us.

## Third parties

To generate a recipe, the submitted video text is processed by **Google Gemini**
(Google's AI API). Google's handling of that request is governed by Google's
privacy policy: https://policies.google.com/privacy. The backend may cache a
generated recipe keyed by the YouTube video id so repeat requests are faster;
this cache contains recipe content only, not anything that identifies you.

## How the data is used

The submitted text is used solely to produce the recipe you requested. We do not
sell or transfer user data to third parties, we do not use it for any purpose
unrelated to this single function, and we do not use it to determine
creditworthiness or for lending.

## Changes

If this policy changes, the updated version will be posted at this URL with a new
"Last updated" date.

## Contact

Questions about this policy: nanavatidevam@gmail.com
