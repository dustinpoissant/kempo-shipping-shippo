import install from './install.js';

/* An update repeats the install: it adds the labels table to a site that installed before labels, and keeps every saved setting and label. */
export default async () => {
  await install();
};
