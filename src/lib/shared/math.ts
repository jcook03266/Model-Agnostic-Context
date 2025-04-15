export namespace Sets {
    /**
     * A - B = Difference between sets A and B (elements which belong to A but not B)
     * This operation is non-commutative: A - B does not equal to B - A
     * 
     * @returns Difference set (elements which belong to A but not B)
     */
    export function difference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
        const difference: Set<T> = new Set<T>();

        setA.forEach((el) => {
            if (!setB.has(el)) difference.add(el);
        });

        return difference;
    }

    export function insersection<T>(setA: Set<T>, setB: Set<T>): Set<T> {
        const insersection: Set<T> = new Set<T>();

        setA.forEach((el) => {
            if (setB.has(el)) insersection.add(el);
        });

        return insersection;
    }
}