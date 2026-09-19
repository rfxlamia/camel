import Lottie from "lottie-react";
import successAnimation from "../assets/success.json";

/**
 * One-shot success tick animation (plays once, stays on last frame).
 * Uses success.json which has a circular green background baked in.
 * Artwork: "Gpay Tick" Lottie asset.
 */
export default function SuccessAnimation({ size = 120 }: { size?: number }) {
	return (
		<div
			className="rounded-full overflow-hidden"
			style={{ width: size, height: size }}
		>
			<Lottie
				animationData={successAnimation}
				loop={false}
				autoplay
				aria-hidden
				style={{ width: size, height: size }}
			/>
		</div>
	);
}
