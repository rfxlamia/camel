import ts from "typescript";

// AST-only detector for literal 400 method calls. Dynamic codes such as
// res.status(code) are intentionally NOT flagged; no constant evaluation occurs.
// Importing this module does not run a CLI or read files.
const METHODS = new Set(["status", "sendStatus", "writeHead"]);

export function scanSource(text, relPath) {
	const source = ts.createSourceFile(
		relPath,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const violations = [];

	function visit(node) {
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const firstArgument = node.arguments[0];
			let method;
			if (ts.isPropertyAccessExpression(callee)) {
				method = callee.name;
			} else if (
				ts.isElementAccessExpression(callee) &&
				callee.argumentExpression &&
				ts.isStringLiteral(callee.argumentExpression)
			) {
				method = callee.argumentExpression;
			}
			if (
				method &&
				METHODS.has(method.text) &&
				firstArgument &&
				ts.isNumericLiteral(firstArgument) &&
				Number(firstArgument.text) === 400
			) {
				// Use the method token's start, excluding receiver and comment trivia.
				const { line } = source.getLineAndCharacterOfPosition(
					method.getStart(source),
				);
				violations.push({ line: line + 1 });
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	return violations;
}
