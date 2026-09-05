import { matchTemplate } from './template-match.js';

self.onmessage = ({ data: { jobs, generation } }) => {
  try {
    const results = jobs.map(({ id, image, template, config }) => ({ id, result: matchTemplate(image, template, config) }));
    self.postMessage({ generation, results });
  } catch (error) {
    self.postMessage({ generation, error: error.message });
  }
};
