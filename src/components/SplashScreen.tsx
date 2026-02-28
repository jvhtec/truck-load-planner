import { useEffect, useState } from 'react';
import './SplashScreen.css';

interface SplashScreenProps {
    onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        // Start fading out after 3.5 seconds
        const fadeTimer = setTimeout(() => {
            setIsFading(true);
        }, 3500);

        // Unmount completely after 4 seconds (matches CSS transition)
        const completeTimer = setTimeout(() => {
            onComplete();
        }, 4000);

        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(completeTimer);
        };
    }, [onComplete]);

    return (
        <div className={`splash-screen ${isFading ? 'fade-out' : ''}`}>
            <div className="splash-content">
                <div className="splash-logo-container">
                    <img src="/icon-192x192.png" alt="Truck Load Planner Logo" className="splash-logo" />
                </div>
                <h1 className="splash-title">Truck Load Planner</h1>
                <div className="splash-loader"></div>
            </div>
        </div>
    );
}
