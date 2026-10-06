// What the view takes from lottie-web, bundled into view/vendor/lottie.js by
// npm run build: a view loads nothing from outside its own folder. The light
// player draws SVG and never evaluates expressions, which the view's
// Content Security Policy would refuse anyway.
export { default } from "lottie-web/build/player/lottie_light.js";
