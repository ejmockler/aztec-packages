/// Copies up to `num_items_to_copy` items from `array2` into `array1`, starting at `start_index`, and returns a new
/// array with the modifications.
///
/// - Fails if writing `array2[i]` into `array1[start_index + i]` would exceed the bounds of `array1`.
/// - Only the first `num_items_to_copy` elements of `array2` are copied.
/// - At most `array2.len()` items from `array2` will be copied.
///
/// Note: This function silently stops copying from `array2` once `array2` ends. It's the caller's responsibility to
/// ensure that `num_items_to_copy` is not greater than `array2.len()` if this is desired.
pub fn copy_items_into_array<T, let N: u32, let M: u32>(
    array1: [T; N],
    start_index: u32,
    array2: [T; M],
    num_items_to_copy: u32,
) -> [T; N] {
    let mut result: [T; N] = array1;
    let mut should_copy_from_array2 = true;
    for i in 0..M {
        should_copy_from_array2 &= i != num_items_to_copy;
        if should_copy_from_array2 {
            result[i + start_index] = array2[i];
        }
    }
    result
}

mod tests {
    use super::copy_items_into_array;

    #[test]
    fn copy_to_fill_from_start_to_middle() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 3 items from array2, starting at index 0 in array1.
        let result = copy_items_into_array(array1, 0, array2, 3);
        assert_eq(result, [10, 20, 30, 4, 5]);
    }

    #[test]
    fn copy_to_fill_from_start_to_end() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 5 items from array2, starting at index 0 in array1.
        let result = copy_items_into_array(array1, 0, array2, 5);
        assert_eq(result, [10, 20, 30, 40, 50]);
    }

    #[test]
    fn copy_to_fill_in_middle() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 3 items from array2, starting at index 1 in array1.
        let result = copy_items_into_array(array1, 1, array2, 3);
        assert_eq(result, [1, 10, 20, 30, 5]);
    }

    #[test]
    fn copy_to_fill_from_middle_to_end() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 3 items from array2, starting at index 2 in array1.
        let result = copy_items_into_array(array1, 2, array2, 3);
        assert_eq(result, [1, 2, 10, 20, 30]);
    }

    #[test(should_fail_with = "Index out of bounds")]
    fn copy_to_overfill_from_start() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 6 items from array2.
        let _ = copy_items_into_array(array1, 0, array2, 6);
    }

    #[test(should_fail_with = "Index out of bounds")]
    fn copy_to_overfill_from_middle() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 3 items from array2, starting at index 3 in array1.
        let _ = copy_items_into_array(array1, 3, array2, 3);
    }

    #[test(should_fail_with = "Index out of bounds")]
    fn copy_to_fill_from_out_of_bounds() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 3 items from array2, starting at index beyond the size of array1.
        let _ = copy_items_into_array(array1, array1.len(), array2, 3);
    }

    #[test]
    fn copy_nothing() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 0 items from array2.
        let result = copy_items_into_array(array1, 0, array2, 0);
        assert_eq(result, [1, 2, 3, 4, 5]);
    }

    #[test]
    fn copy_to_nothing_to_fill_from_out_of_bounds() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30, 40, 50, 60];
        // Copy 0 items from array2, starting at index beyond the size of array1.
        let result = copy_items_into_array(array1, array1.len(), array2, 0);
        // It didn't fail. Nothing was copied.
        assert_eq(result, [1, 2, 3, 4, 5]);
    }

    #[test]
    fn copy_more_than_array2_length() {
        let array1 = [1, 2, 3, 4, 5];
        let array2 = [10, 20, 30];
        // Copy more items than array2 has.
        let result = copy_items_into_array(array1, 0, array2, array2.len() + 1);
        // It didn't fail. All items in array2 were copied.
        assert_eq(result, [10, 20, 30, 4, 5]);
    }
}
