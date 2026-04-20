import { mergeStatement, publicAssetsStatement } from "../src/connectors/bucket-policy.mjs";

describe("mergeStatement", () => {
  it("merging into null returns a fresh policy containing exactly the new statement", () => {
    const stmt = { Sid: "TestSid", Effect: "Allow", Action: "s3:GetObject", Resource: "*" };
    const result = mergeStatement(null, stmt);
    expect(result.Version).toBe("2012-10-17");
    expect(result.Statement).toHaveLength(1);
    expect(result.Statement[0]).toBe(stmt);
  });

  it("merging into a policy without the Sid appends at the end and preserves existing statements' order", () => {
    const existing = [
      { Sid: "First", Effect: "Allow", Action: "s3:PutObject", Resource: "*" },
      { Sid: "Second", Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" },
    ];
    const policy = { Version: "2012-10-17", Statement: existing };
    const newStmt = { Sid: "Third", Effect: "Allow", Action: "s3:GetObject", Resource: "*" };
    const result = mergeStatement(policy, newStmt);
    expect(result.Statement).toHaveLength(3);
    expect(result.Statement[0].Sid).toBe("First");
    expect(result.Statement[1].Sid).toBe("Second");
    expect(result.Statement[2]).toBe(newStmt);
  });

  it("merging into a policy that already has the Sid replaces in place without changing position or order of others", () => {
    const original = { Sid: "ToReplace", Effect: "Allow", Action: "s3:GetObject", Resource: "old" };
    const policy = {
      Version: "2012-10-17",
      Statement: [
        { Sid: "Before", Effect: "Allow", Action: "s3:PutObject", Resource: "*" },
        original,
        { Sid: "After", Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" },
      ],
    };
    const updated = { Sid: "ToReplace", Effect: "Allow", Action: "s3:GetObject", Resource: "new" };
    const result = mergeStatement(policy, updated);
    expect(result.Statement).toHaveLength(3);
    expect(result.Statement[0].Sid).toBe("Before");
    expect(result.Statement[1]).toBe(updated);
    expect(result.Statement[1].Resource).toBe("new");
    expect(result.Statement[2].Sid).toBe("After");
  });

  it("throws when called with a statement missing Sid", () => {
    const stmt = { Effect: "Allow", Action: "s3:GetObject", Resource: "*" };
    expect(() => mergeStatement(null, stmt)).toThrow("statement.Sid is required");
  });
});

describe("publicAssetsStatement", () => {
  it('returns the documented shape for bucket "foo"', () => {
    const stmt = publicAssetsStatement("foo");
    expect(stmt.Sid).toBe("ModelopsPublicAssets");
    expect(stmt.Effect).toBe("Allow");
    expect(stmt.Principal).toBe("*");
    expect(stmt.Action).toBe("s3:GetObject");
    expect(stmt.Resource).toBe("arn:aws:s3:::foo/assets/*");
  });
});
