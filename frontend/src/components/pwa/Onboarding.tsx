import React, { useState } from "react";

interface OnboardingStep {
  title: string;
  description: string;
  image?: string;
  icon: string;
  tips?: string[];
}

interface OnboardingProps {
  onComplete?: () => void;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Welcome to iOS Screen Time",
    description:
      "Process iOS battery and screen time screenshots with ease. Extract hourly usage data and export to CSV or Excel.",
    icon: "👋",
    tips: [
      "Works 100% offline in Local Mode",
      "All data stays on your device",
      "No server required for local processing",
    ],
  },
  {
    title: "Choose Your Mode",
    description:
      "Select between Server Mode (faster, requires backend) or Local Mode (offline, private).",
    icon: "⚙️",
    tips: [
      "Server Mode: Faster processing with GPU acceleration",
      "Local Mode: Complete privacy, works offline",
      "Switch modes anytime from settings",
    ],
  },
  {
    title: "Upload Screenshots",
    description:
      "Drag and drop your iPhone screenshots or click to browse. Supports both Battery and Screen Time images.",
    icon: "📱",
    tips: [
      "Supported: Battery Usage and Screen Time screenshots",
      "Multiple uploads at once",
      "Auto-detection of screenshot type",
    ],
  },
  {
    title: "Select the Grid",
    description:
      "Click and drag to select the 24-hour usage bar graph. The app will auto-detect the grid if possible.",
    icon: "🎯",
    tips: [
      "Auto-detection works most of the time",
      "Manual selection for better accuracy",
      "Zoom in for precise selection",
    ],
  },
  {
    title: "Review & Export",
    description:
      "Review the extracted hourly data, make corrections if needed, and export to CSV or Excel.",
    icon: "✅",
    tips: [
      "Edit any extracted values",
      "Export to CSV, Excel, or JSON",
      "Create backups of all your data",
    ],
  },
  {
    title: "Keyboard Shortcuts",
    description: "Use keyboard shortcuts for faster workflow.",
    icon: "⌨️",
    tips: [
      "Ctrl/Cmd + S: Save annotation",
      "Ctrl/Cmd + E: Export data",
      "Ctrl/Cmd + K: Show keyboard shortcuts",
      "Escape: Close dialogs",
    ],
  },
];

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  // Use lazy initializer to read from localStorage once on mount
  const [showOnboarding, setShowOnboarding] = useState(() => {
    const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding");
    return hasSeenOnboarding !== "true";
  });

  if (!showOnboarding) {
    return null;
  }

  const handleNext = () => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem("hasSeenOnboarding", "true");
    setShowOnboarding(false);
    if (onComplete) onComplete();
  };

  const handleSkip = () => {
    localStorage.setItem("hasSeenOnboarding", "true");
    setShowOnboarding(false);
    if (onComplete) onComplete();
  };

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  if (!step) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="text-4xl">{step.icon}</span>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {step.title}
                </h2>
                <p className="text-sm text-gray-500">
                  Step {currentStep + 1} of {ONBOARDING_STEPS.length}
                </p>
              </div>
            </div>
            <button
              onClick={handleSkip}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Skip tutorial"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${((currentStep + 1) / ONBOARDING_STEPS.length) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <p className="text-lg text-gray-700">{step.description}</p>

            {step.tips && step.tips.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">
                  Key Points:
                </h3>
                <ul className="space-y-2">
                  {step.tips.map((tip, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-blue-800 flex items-start gap-2"
                    >
                      <svg
                        className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-6 border-t border-gray-200">
            <button
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="flex gap-1">
              {ONBOARDING_STEPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentStep(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === currentStep
                      ? "bg-blue-600 w-6"
                      : "bg-gray-300 hover:bg-gray-400"
                  }`}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {isLastStep ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const showOnboarding = () => {
  localStorage.removeItem("hasSeenOnboarding");
};
