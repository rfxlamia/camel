import Lottie from "lottie-react";
import camelAnimation from "../assets/camel-loading.json";

/**
 * Loading indicator: a camel line-art that draws itself on, fills in, then
 * loops. The animation has a transparent background so it sits over any
 * surface. Camel artwork by Alvaro Cabrera (the Noun Project).
 */
export default function LoadingCamel({ size = 200 }: { size?: number }) {
	return (
		<Lottie
			animationData={camelAnimation}
			loop
			autoplay
			role="img"
			aria-label="Loading"
			style={{ width: size, height: size }}
		/>
	);
}
