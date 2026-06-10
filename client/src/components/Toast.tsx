interface Props {
  message: string;
}

export default function Toast({ message }: Props) {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-error-500 bg-error-100 px-4 py-2.5 text-sm font-medium text-error-900 shadow-md"
    >
      {message}
    </div>
  );
}
