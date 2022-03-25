import * as ts from 'typescript';
import { COMMON_IDENTIFIERS } from './identifiers';
import {
  DatabaseDefinition,
  FieldDefinition,
  TableDefinition,
  TypeNode,
} from '../parser';
import {
  createClientFunction,
  createClientTypeDeclaration,
  createClientTypeNode,
} from './client';
import { createAddArgsTypeDeclaration } from './client/addMethod';
import {
  createGetArgsTypeDeclaration,
  createIndexPredicates,
} from './client/getMethod';
import { createConstStatement, createNewPromiseWithBody } from './helpers';
import {
  annotationsFromList,
  getPrimaryKeyFieldForTable,
  getIndexFieldsForTable,
  isAutoIncrementField,
} from './keys';
import { createBooleanLiteral } from './types';
import { createItemTypeWithJoinsForTable } from './joins';

export function renderDatabaseDefinition(
  def: DatabaseDefinition,
): ReadonlyArray<ts.Statement> {
  return [
    ...def.body.flatMap((next) => {
      return createItemTypeWithJoinsForTable(next, def);
    }),
    ...def.body.map((next) => {
      return createAddArgsTypeDeclaration(next);
    }),
    ...def.body.map((next) => {
      return createGetArgsTypeDeclaration(next, def);
    }),
    ...def.body.flatMap((next) => {
      return createIndexPredicates(next, def);
    }),
    createClientTypeDeclaration(def),
    createClientFunction(def),
    ts.factory.createFunctionDeclaration(
      undefined,
      [ts.factory.createToken(ts.SyntaxKind.ExportKeyword)],
      undefined,
      ts.factory.createIdentifier('init'),
      undefined,
      [],
      ts.factory.createTypeReferenceNode(COMMON_IDENTIFIERS.Promise, [
        createClientTypeNode(def),
      ]),
      ts.factory.createBlock(
        [
          ts.factory.createReturnStatement(
            createNewPromiseWithBody(
              ts.factory.createBlock(
                [
                  createConstStatement(
                    COMMON_IDENTIFIERS.DBOpenRequest,
                    undefined,
                    ts.factory.createCallExpression(
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createPropertyAccessExpression(
                          COMMON_IDENTIFIERS.globalThis,
                          'indexedDB',
                        ),
                        'open',
                      ),
                      undefined,
                      [ts.factory.createStringLiteral(def.name.value)],
                    ),
                  ),
                  createEventHandler('onerror', [
                    ts.factory.createExpressionStatement(
                      ts.factory.createCallExpression(
                        COMMON_IDENTIFIERS.reject,
                        undefined,
                        [
                          ts.factory.createStringLiteral(
                            `Error opening database: ${def.name.value}`,
                          ),
                        ],
                      ),
                    ),
                  ]),
                  createEventHandler('onsuccess', [
                    createDbAssignment(),
                    createCallToCreateClient(),
                  ]),
                  createEventHandler('onupgradeneeded', [
                    createDbAssignment(),
                    ...createObjectStores(def),
                    ...createObjectStoreIndexes(def),
                  ]),
                ],
                true,
              ),
            ),
          ),
        ],
        true,
      ),
    ),
  ];
}

function createCallToCreateClient(): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(COMMON_IDENTIFIERS.resolve, undefined, [
      ts.factory.createCallExpression(
        ts.factory.createIdentifier('createDatabaseClient'),
        undefined,
        [COMMON_IDENTIFIERS.db],
      ),
    ]),
  );
}

function identifierForObjectStore(def: TableDefinition): ts.Identifier {
  return ts.factory.createIdentifier(`${def.name.value}Store`);
}

function createObjectStores(
  def: DatabaseDefinition,
): ReadonlyArray<ts.Statement> {
  return def.body.map((next) => {
    const indexesForTable = getIndexFieldsForTable(next);
    const objectStore = ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        COMMON_IDENTIFIERS.db,
        ts.factory.createIdentifier('createObjectStore'),
      ),
      undefined,
      [
        ts.factory.createStringLiteral(next.name.value),
        createOptionsForObjectStore(next),
      ],
    );

    return indexesForTable.length > 0
      ? createConstStatement(
          identifierForObjectStore(next),
          undefined,
          objectStore,
        )
      : ts.factory.createExpressionStatement(objectStore);
  });
}

function createOptionsForObjectStore(
  def: TableDefinition,
): ts.ObjectLiteralExpression {
  const primaryKeyField = getPrimaryKeyFieldForTable(def);
  const options = [
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier('keyPath'),
      ts.factory.createStringLiteral(primaryKeyField.name.value),
    ),
  ];

  if (isAutoIncrementField(primaryKeyField)) {
    options.push(
      ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier('autoIncrement'),
        ts.factory.createTrue(),
      ),
    );
  }

  return ts.factory.createObjectLiteralExpression(options);
}

function createObjectStoreIndexes(
  def: DatabaseDefinition,
): ReadonlyArray<ts.Statement> {
  return def.body.flatMap((next) => {
    return createIndexesForStore(next);
  });
}

function createIndexesForStore(
  def: TableDefinition,
): ReadonlyArray<ts.Statement> {
  const indexes = getIndexFieldsForTable(def);
  return indexes.map((next) => {
    return ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          identifierForObjectStore(def),
          'createIndex',
        ),
        undefined,
        [
          ts.factory.createStringLiteral(next.name.value),
          ts.factory.createStringLiteral(next.name.value),
          optionsForIndex(next),
        ],
      ),
    );
  });
}

function optionsForIndex(def: FieldDefinition): ts.ObjectLiteralExpression {
  const isFieldUnique =
    annotationsFromList(def.annotations, ['unique']) != null;
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier('unique'),
      createBooleanLiteral(isFieldUnique),
    ),
  ]);
}

function createDbAssignment(): ts.Statement {
  return createConstStatement(
    COMMON_IDENTIFIERS.db,
    undefined,
    ts.factory.createPropertyAccessExpression(
      COMMON_IDENTIFIERS.DBOpenRequest,
      ts.factory.createIdentifier('result'),
    ),
  );
}

function createEventHandler(
  eventName: string,
  eventStatements: ReadonlyArray<ts.Statement>,
): ts.ExpressionStatement {
  return ts.factory.createExpressionStatement(
    ts.factory.createAssignment(
      ts.factory.createPropertyAccessExpression(
        COMMON_IDENTIFIERS.DBOpenRequest,
        eventName,
      ),
      ts.factory.createArrowFunction(
        undefined,
        undefined,
        [], // params
        undefined,
        undefined,
        ts.factory.createBlock(eventStatements, true),
      ),
    ),
  );
}
